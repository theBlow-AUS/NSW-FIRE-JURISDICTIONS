export const FIRE_SERVICE_URL =
  'https://portal.data.nsw.gov.au/arcgis/rest/services/Hosted/FRNSW_Locations/FeatureServer';
export const DISTRICT_LAYER_URL = `${FIRE_SERVICE_URL}/1`;
export const STATIONS_LAYER_URL = `${FIRE_SERVICE_URL}/0`;
export const ARCGIS_SOURCE_LINK =
  FIRE_SERVICE_URL;
export const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
export const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

// Public Nominatim requires deliberate searches, with at most one request/second.
let nextGeocodeRequest = 0;
async function geocodeFetch(url: string, options: RequestInit): Promise<Response> {
  const now = Date.now();
  const delay = Math.max(0, nextGeocodeRequest - now);
  nextGeocodeRequest = now + delay + 1100;
  if (delay) await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
  options.signal?.throwIfAborted();
  return fetch(url, options);
}

export type CoverageKind = 'frnsw' | 'rural' | 'outside' | 'error';
export type CoverageResult = {
  kind: CoverageKind;
  district?: string;
  message?: string;
  checkedAt: string;
};

export type NswConfirmation = 'nsw' | 'not-nsw' | 'unknown';

type ArcGisFeatureCollection = {
  features?: Array<{ attributes?: Record<string, string | number | null> }>;
  error?: { message?: string; details?: string[] };
};

export function confirmNsw(address: string, addressDetails?: Record<string, unknown>): NswConfirmation {
  const state = String(addressDetails?.state ?? addressDetails?.province ?? '').toLowerCase();
  const display = address.toLowerCase();
  if (state === 'nsw' || state.includes('new south wales') || /,\s*nsw(?:\s|,|$)/i.test(address)) return 'nsw';
  if (state && state !== 'nsw' && !state.includes('new south wales')) return 'not-nsw';
  if (/\b(new south wales|nsw)\b/i.test(display)) return 'nsw';
  return 'unknown';
}

export async function lookupCoverage(
  latitude: number,
  longitude: number,
  nsw: NswConfirmation,
): Promise<CoverageResult> {
  const checkedAt = new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
  if (nsw === 'not-nsw') return { kind: 'outside', checkedAt };

  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    geometry: JSON.stringify({ x: longitude, y: latitude, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'district',
    returnGeometry: 'false',
  });
  try {
    const response = await fetch(`${DISTRICT_LAYER_URL}/query?${params.toString()}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Coverage service returned HTTP ${response.status}.`);
    const data = (await response.json()) as ArcGisFeatureCollection;
    if (data.error) throw new Error(data.error.message || 'The coverage service returned an error.');
    if (!Array.isArray(data.features)) throw new Error('The coverage service returned an unexpected response.');
    const feature = data.features[0];
    if (feature) {
      const district = feature.attributes?.district;
      return { kind: 'frnsw', district: district == null ? undefined : String(district), checkedAt };
    }
    if (nsw === 'nsw') return { kind: 'rural', checkedAt };
    return {
      kind: 'error',
      checkedAt,
      message: 'The address could not be confirmed as being in NSW, so a rural district result cannot be inferred.',
    };
  } catch (error) {
    return {
      kind: 'error',
      checkedAt,
      message: error instanceof Error ? error.message : 'Could not reach the NSW fire coverage service.',
    };
  }
}

export type AddressSuggestion = {
  id: string;
  displayName: string;
  shortName: string;
  latitude: number;
  longitude: number;
  address: Record<string, unknown>;
};

export async function searchAddresses(query: string, signal?: AbortSignal): Promise<AddressSuggestion[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '5',
    countrycodes: 'au',
    viewbox: '140.999,-28.0,153.64,-37.7',
    bounded: '1',
  });
  const response = await geocodeFetch(`${NOMINATIM_SEARCH_URL}?${params.toString()}`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Address search returned HTTP ${response.status}.`);
  const data = (await response.json()) as Array<{
    place_id: number;
    display_name: string;
    lat: string;
    lon: string;
    address?: Record<string, unknown>;
  }>;
  return data.map((place) => ({
    id: String(place.place_id),
    displayName: place.display_name,
    shortName: [
      place.address?.house_number,
      place.address?.road,
      place.address?.suburb ?? place.address?.town ?? place.address?.city,
    ].filter(Boolean).join(' ') || place.display_name.split(',').slice(0, 2).join(','),
    latitude: Number(place.lat),
    longitude: Number(place.lon),
    address: place.address ?? {},
  }));
}

export async function reverseAddress(latitude: number, longitude: number): Promise<{
  displayName: string;
  address: Record<string, unknown>;
}> {
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    format: 'jsonv2',
    addressdetails: '1',
    zoom: '18',
  });
  const response = await geocodeFetch(`${NOMINATIM_REVERSE_URL}?${params.toString()}`, {
    signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Reverse address lookup returned HTTP ${response.status}.`);
  const result = (await response.json()) as { display_name?: string; address?: Record<string, unknown>; error?: string };
  if (result.error || !result.display_name) throw new Error(result.error || 'No address was found at this map point.');
  return { displayName: result.display_name, address: result.address ?? {} };
}
