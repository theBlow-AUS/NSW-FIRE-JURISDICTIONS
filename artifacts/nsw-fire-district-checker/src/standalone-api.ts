export interface GeoJsonGeometry {
  type: string;
  coordinates?: unknown;
  geometries?: GeoJsonGeometry[];
}

export interface GeoJsonFeature {
  type: 'Feature';
  id?: string | number;
  geometry: GeoJsonGeometry | null;
  properties: Record<string, unknown> | null;
}

export interface GeoJsonCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
  name?: string;
  crs?: unknown;
}

export interface GisLayerStyle {
  color: string;
  fillOpacity: number;
}

export interface GisLayerSummary {
  revision?: number;
  bounds?: number[] | null;
  id: string;
  name: string;
  sourceName: string;
  sourceFormat: string;
  crs: string | null;
  geometryType: string;
  featureCount: number;
  fields: string[];
  visible: boolean;
  style: GisLayerStyle;
  sourceUpdatedAt: string | null;
  importedAt: string;
  warning: string | null;
}

export interface GisLayer extends GisLayerSummary {
  collection: GeoJsonCollection;
  ordinals?: number[];
  truncated?: boolean;
}

export interface AttributePage {
  items: { ordinal: number; feature: GeoJsonFeature; geometryType: string }[];
  total: number;
  offset: number;
  nextOffset: number | null;
}

export interface GisProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  layers: GisLayerSummary[];
}

export interface FeedSourceStatus {
  id: string;
  name: string;
  url: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  sourceUpdatedAt: string | null;
  nextFetchAt: string | null;
  featureCount: number;
  stale: boolean;
  error: string | null;
}

export interface FireDangerRegion {
  id: string;
  regionNumber: string | null;
  name: string;
  councils: string[];
  dangerToday: string | null;
  dangerTomorrow: string | null;
  fireBanToday: string | null;
  fireBanTomorrow: string | null;
}

export interface LiveFeedState {
  sources: FeedSourceStatus[];
  incidents: GeoJsonCollection;
  majorFireUpdates: GeoJsonCollection;
  dangerRegions: FireDangerRegion[];
}

export interface StandaloneState {
  projects: GisProject[];
  feeds: LiveFeedState;
}

export class StandaloneApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'StandaloneApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...init?.headers,
      },
    });
  } catch {
    throw new StandaloneApiError('The local GIS service is unavailable.', 0);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new StandaloneApiError(
      typeof body?.error === 'string' ? body.error : `Local service error (${response.status}).`,
      response.status,
    );
  }
  return body as T;
}

export function getStandaloneState(): Promise<StandaloneState> {
  return request('/api/gis/state');
}

export function createGisProject(name: string): Promise<GisProject> {
  return request('/api/gis/projects', { method: 'POST', body: JSON.stringify({ name }) });
}

export function renameGisProject(id: string, name: string): Promise<GisProject> {
  return request(`/api/gis/projects/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
}

export async function deleteGisProject(id: string): Promise<void> {
  await request(`/api/gis/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function importGisFiles(id: string, files: FileList | File[]): Promise<{ layers: GisLayerSummary[]; warnings: string[] }> {
  const body = new FormData();
  for (const file of Array.from(files)) {
    body.append('files', file, ('webkitRelativePath' in file && file.webkitRelativePath) || file.name);
  }
  return request(`/api/gis/projects/${encodeURIComponent(id)}/import`, { method: 'POST', body });
}

export function getGisLayer(projectId: string, layerId: string, bbox?: number[]): Promise<GisLayer> {
  return request(`/api/gis/projects/${encodeURIComponent(projectId)}/layers/${encodeURIComponent(layerId)}${bbox ? `?bbox=${bbox.join(',')}` : ''}`);
}

export function getGisAttributes(projectId: string, layerId: string, offset: number, search: string): Promise<AttributePage> {
  return request(`/api/gis/projects/${projectId}/layers/${layerId}/attributes?offset=${offset}&search=${encodeURIComponent(search)}`);
}

export function getGisFeature(projectId: string, layerId: string, ordinal: number): Promise<{ feature: GeoJsonFeature; ordinal: number; revision: number }> {
  return request(`/api/gis/projects/${projectId}/layers/${layerId}/features/${ordinal}`);
}

export function saveGisLayer(projectId: string, layerId: string, layer: GisLayerSummary, edits: { ordinal: number; feature: GeoJsonFeature }[] = []): Promise<GisLayerSummary> {
  return request(`/api/gis/projects/${encodeURIComponent(projectId)}/layers/${encodeURIComponent(layerId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: layer.name,
      visible: layer.visible,
      style: layer.style,
      revision: layer.revision ?? 0,
      edits,
    }),
  });
}

export async function deleteGisLayer(projectId: string, layerId: string): Promise<void> {
  await request(`/api/gis/projects/${encodeURIComponent(projectId)}/layers/${encodeURIComponent(layerId)}`, {
    method: 'DELETE',
  });
}

export function refreshLiveFeeds(): Promise<{ requested: boolean }> {
  return request('/api/feeds/refresh', { method: 'POST', body: JSON.stringify({}) });
}

export function geoJsonDownloadUrl(projectId: string, layerId: string): string {
  return `/api/gis/projects/${encodeURIComponent(projectId)}/layers/${encodeURIComponent(layerId)}/export`;
}
