import { normalizeHouseNumber, parseAddressInput } from './address-input';

export const ADDRESS_SOURCE_LINK = 'https://www.data.nsw.gov.au/data/dataset/address-location-service';
const ADDRESS_LOCATION_URL = 'https://mapsq.six.nsw.gov.au/services/public/Address_Location';
const GURAS_POINT_URL = 'https://maps.six.nsw.gov.au/arcgis/rest/services/sixmaps/Guras/MapServer/2/query';
const LOCALITY_URL = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Administrative_Boundaries/MapServer/0/query';
const ADDRESS_FIELDS = 'delivsdm:geodb.AddressString.';
const STATE_NAMES: Record<number, string> = {
  1: 'Australian Capital Territory', 2: 'New South Wales', 3: 'Victoria',
  4: 'Queensland', 5: 'South Australia',
};

export type AddressSuggestion = {
  id: string;
  displayName: string;
  shortName: string;
  latitude: number;
  longitude: number;
  address: Record<string, unknown>;
  matchNote?: string;
};

type GurasAddress = {
  objectId?: number;
  houseNumberString?: string;
  roadName?: string;
  roadType?: string;
  roadSuffix?: string;
  suburbName?: string;
  postCode?: number;
  addressPoint?: { centreX?: number; centreY?: number };
};

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`NSW addressing service returned HTTP ${response.status}. Please try again.`);
  return response.json() as Promise<T>;
}

export async function searchAddresses(query: string, locality: string, signal?: AbortSignal): Promise<AddressSuggestion[]> {
  const input = parseAddressInput(query, locality);
  const params = new URLSearchParams({ ...input, projection: 'EPSG:4326' });
  const data = await fetchJson<{
    addressResult?: {
      errMsg?: string | null;
      numRecs?: number;
      addresses?: GurasAddress[];
      searchMethod?: { methodDescriptions?: string[] };
    };
  }>(`${ADDRESS_LOCATION_URL}?${params}`, signal);
  const result = data.addressResult;
  if (!result) throw new Error('The NSW address service returned an unexpected response.');
  if (result.errMsg) {
    if (result.numRecs === 0 && /no (?:records|addresses|matches|results)|not found/i.test(result.errMsg)) return [];
    throw new Error(result.errMsg);
  }
  if (!Array.isArray(result.addresses)) {
    if (result.numRecs === 0) return [];
    throw new Error('The NSW address service did not return address records.');
  }
  const adjustments = (result.searchMethod?.methodDescriptions ?? [])
    .filter((method) => !/^(?:Input parameters matched|Addresses? Returned)$/i.test(method));
  const seen = new Set<string>();
  const matches: AddressSuggestion[] = [];
  for (const place of result.addresses) {
    // The NSW service can substitute the nearest house number. Never present
    // that as a match for the number the user actually entered.
    if (normalizeHouseNumber(place.houseNumberString ?? '') !== input.houseNumber) continue;
    const latitude = place.addressPoint?.centreY;
    const longitude = place.addressPoint?.centreX;
    if (typeof latitude !== 'number' || typeof longitude !== 'number'
      || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) continue;
    const street = [place.houseNumberString, place.roadName, place.roadType, place.roadSuffix].filter(Boolean).join(' ');
    const displayName = `${street}, ${place.suburbName ?? ''} NSW ${place.postCode ?? ''}`.trim();
    const key = `${displayName}:${latitude}:${longitude}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({
      id: String(place.objectId ?? key),
      displayName,
      shortName: street,
      latitude,
      longitude,
      address: { state: 'New South Wales', suburb: place.suburbName, postcode: place.postCode },
      ...(adjustments.length ? { matchNote: `Check returned address: ${adjustments.join('; ')}.` } : {}),
    });
  }
  return matches.slice(0, 10);
}

type SpatialFeature = {
  attributes?: Record<string, string | number | null>;
  geometry?: { x: number; y: number };
};
type SpatialResponse = {
  features?: SpatialFeature[];
  error?: { message?: string };
};

async function spatialQuery(url: string, params: URLSearchParams): Promise<SpatialFeature[]> {
  const data = await fetchJson<SpatialResponse>(`${url}?${params}`);
  if (data.error) throw new Error(data.error.message || 'NSW spatial address query failed.');
  if (!Array.isArray(data.features)) throw new Error('The NSW spatial service returned an unexpected response.');
  return data.features;
}

function distanceMetres(latitude: number, longitude: number, point: { x: number; y: number }): number {
  const toRadians = Math.PI / 180;
  const a = Math.sin((point.y - latitude) * toRadians / 2) ** 2
    + Math.cos(latitude * toRadians) * Math.cos(point.y * toRadians)
    * Math.sin((point.x - longitude) * toRadians / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export async function reverseAddress(latitude: number, longitude: number): Promise<{
  displayName: string;
  address: Record<string, unknown>;
  matchNote?: string;
}> {
  const params = new URLSearchParams({
    f: 'json', geometry: `${longitude},${latitude}`, geometryType: 'esriGeometryPoint',
    inSR: '4326', spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'false',
    outFields: 'suburbname,postcode,state',
  });
  const points = new URLSearchParams(params);
  points.set('where', '1=1');
  points.set('returnGeometry', 'true');
  points.set('outSR', '4326');
  points.set('distance', '75');
  points.set('units', 'esriSRUnit_Meter');
  points.set('outFields', [
    'housenumberfirst', 'housenumberfirstsuffix', 'housenumbersecond',
    'housenumbersecondsuffix', 'roadname', 'roadtype', 'roadsuffix', 'suburbname', 'postcode',
  ].map((field) => `${ADDRESS_FIELDS}${field}`).join(','));
  // This GURAS layer does not support pagination: do not send resultRecordCount.
  const [localities, nearby] = await Promise.all([
    spatialQuery(LOCALITY_URL, params),
    spatialQuery(GURAS_POINT_URL, points).then((features) => ({ features, failed: false }))
      .catch(() => ({ features: [] as SpatialFeature[], failed: true })),
  ]);
  const locality = localities[0]?.attributes;
  const state = STATE_NAMES[Number(locality?.state)];
  if (!locality || !state) return {
    displayName: 'Dropped pin — locality unavailable',
    address: {},
    matchNote: 'No locality was identified at this pin. NSW coverage cannot be confirmed.',
  };
  const address = { state, suburb: locality.suburbname, postcode: locality.postcode };
  const place = `${locality.suburbname ?? ''}, ${state} ${locality.postcode ?? ''}`.trim();
  const nearest = nearby.features
    .filter((feature) => feature.geometry && Number.isFinite(feature.geometry.x) && Number.isFinite(feature.geometry.y))
    .map((feature) => ({ feature, distance: distanceMetres(latitude, longitude, feature.geometry!) }))
    .filter((entry) => entry.distance <= 75)
    .sort((a, b) => a.distance - b.distance)[0];
  if (!nearest) return {
    displayName: `Dropped pin in ${place}`,
    address,
    matchNote: nearby.failed
      ? 'GURAS address-point lookup is unavailable. Coverage is checked at your dropped pin.'
      : 'No GURAS address point within 75 m. Coverage is checked at your dropped pin.',
  };
  const get = (field: string) => nearest.feature.attributes?.[`${ADDRESS_FIELDS}${field}`];
  const first = `${get('housenumberfirst') ?? ''}${get('housenumberfirstsuffix') ?? ''}`;
  const second = get('housenumbersecond');
  const number = second ? `${first}-${second}${get('housenumbersecondsuffix') ?? ''}` : first;
  const street = [number, get('roadname'), get('roadtype'), get('roadsuffix')].filter(Boolean).join(' ');
  return {
    displayName: `Near ${street}, ${place}`,
    address,
    matchNote: `Nearby GURAS property address point (${Math.round(nearest.distance)} m away). Coverage uses the pin's exact coordinates, not the address point.`,
  };
}
