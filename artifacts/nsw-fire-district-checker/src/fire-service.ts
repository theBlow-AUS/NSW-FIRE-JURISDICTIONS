export const FIRE_SERVICE_URL =
  'https://portal.data.nsw.gov.au/arcgis/rest/services/Hosted/FRNSW_Locations/FeatureServer';
export const DISTRICT_LAYER_URL = `${FIRE_SERVICE_URL}/1`;
export const STATIONS_LAYER_URL = `${FIRE_SERVICE_URL}/0`;
export const ARCGIS_SOURCE_LINK =
  FIRE_SERVICE_URL;

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
  if (state === 'nsw' || state.includes('new south wales')) return 'nsw';
  if (state) return 'not-nsw';
  if (/,\s*nsw(?:\s|,|$)/i.test(address)) return 'nsw';
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

