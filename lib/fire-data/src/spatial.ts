import { FRNSW_SOURCE, LGA_SOURCE, normaliseLga, type SpatialContext } from './context';

type Feature = { attributes?: Record<string, unknown> };
async function queryPoint(url: string, latitude: number, longitude: number, outFields: string): Promise<Feature[]> {
  const params = new URLSearchParams({
    f: 'json', where: '1=1',
    geometry: JSON.stringify({ x: longitude, y: latitude, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    outFields, returnGeometry: 'false',
  });
  const response = await fetch(`${url}/query?${params}`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Spatial service returned HTTP ${response.status}.`);
  const body = await response.json() as { features?: Feature[]; error?: { message?: string } };
  if (body.error || !Array.isArray(body.features)) throw new Error(body.error?.message || 'Unexpected spatial service response.');
  return body.features;
}

export async function lookupSpatialContext(latitude: number, longitude: number): Promise<SpatialContext> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return { kind: 'error', district: null, lga: null, message: 'Enter valid decimal latitude and longitude.' };
  }
  const [frnsw, local] = await Promise.allSettled([
    queryPoint(FRNSW_SOURCE, latitude, longitude, 'district'),
    queryPoint(LGA_SOURCE, latitude, longitude, 'lganame'),
  ]);
  const names = local.status === 'fulfilled'
    ? [...new Set(local.value.map((f) => String(f.attributes?.lganame ?? '').trim()).filter(Boolean))]
    : [];
  const lga = names.length === 1 ? names[0] : null;
  // No RFS information may override a failed or positive FRNSW boundary check.
  if (frnsw.status === 'rejected') return {
    kind: 'error', district: null, lga,
    message: 'FRNSW boundaries could not be checked. RFS information is withheld because FRNSW takes priority.',
  };
  if (frnsw.value.length) return {
    kind: 'frnsw', district: String(frnsw.value[0].attributes?.district ?? '') || null, lga,
    message: 'The FRNSW boundary takes priority. LGA-based RFS permit data and contacts are not applied to this point.',
  };
  if (local.status === 'rejected') return {
    kind: 'error', district: null, lga: null,
    message: 'The NSW LGA could not be confirmed. A rural district result cannot be inferred.',
  };
  if (names.length > 1 && new Set(names.map(normaliseLga)).size > 1) return {
    kind: 'error', district: null, lga: null,
    message: 'This point intersects more than one LGA boundary. Move the pin slightly and confirm the location.',
  };
  if (!names.length) return {
    kind: 'outside', district: null, lga: null, message: 'No NSW LGA was found at this point. RFS data is not applied.',
  };
  return {
    kind: 'rural', district: null, lga: names[0],
    message: 'This NSW LGA point is outside mapped FRNSW districts. Rural Fire District coverage is inferred.',
  };
}
