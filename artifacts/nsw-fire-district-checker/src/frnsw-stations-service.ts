import type { MapPoint } from './MapPanel';
import { STATIONS_LAYER_URL } from './fire-service';

export type FrnswStation = {
  name: string;
  stationNumber: string;
  address: string;
  town: string;
  postcode: string;
  point: MapPoint;
  distanceKm: number;
};

type StationFeature = {
  attributes?: {
    stationnam?: string | null;
    stationno?: string | number | null;
    address?: string | null;
    town?: string | null;
    postcode?: string | number | null;
  };
  geometry?: { x?: number; y?: number };
};

type StationResponse = {
  features?: StationFeature[];
  error?: { message?: string };
  exceededTransferLimit?: boolean;
};

const STATIONS_SOURCE_LINK = `${STATIONS_LAYER_URL}`;
let stationsRequest: Promise<StationFeature[]> | null = null;

function fetchStations(): Promise<StationFeature[]> {
  if (stationsRequest) return stationsRequest;

  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    outFields: 'stationnam,stationno,address,town,postcode',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '1000',
  });
  stationsRequest = fetch(`${STATIONS_SOURCE_LINK}/query?${params}`, {
    signal: AbortSignal.timeout(20000),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`FRNSW station data returned HTTP ${response.status}.`);
    const data = (await response.json()) as StationResponse;
    if (data.error) throw new Error(data.error.message || 'The FRNSW station service returned an error.');
    if (!Array.isArray(data.features)) throw new Error('The FRNSW station service returned an unexpected response.');
    if (data.exceededTransferLimit) throw new Error('The FRNSW station list was incomplete.');
    return data.features;
  }).catch((error: unknown) => {
    stationsRequest = null;
    throw error;
  });
  return stationsRequest;
}

function distanceKm(a: MapPoint, b: MapPoint) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export async function getNearbyFrnswStations(point: MapPoint, limit = 3): Promise<FrnswStation[]> {
  const features = await fetchStations();
  return features.flatMap((feature) => {
    const attributes = feature.attributes;
    const longitude = feature.geometry?.x;
    const latitude = feature.geometry?.y;
    if (!attributes) return [];
    const number = Number(attributes?.stationno);
    const name = attributes?.stationnam?.trim();
    if (!name || !Number.isFinite(number) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];

    return [{
      name,
      stationNumber: String(Math.trunc(number)).padStart(3, '0'),
      address: attributes.address?.trim() ?? '',
      town: attributes.town?.trim() ?? '',
      postcode: attributes.postcode == null ? '' : String(attributes.postcode).replace(/\.0$/, ''),
      point: { latitude: latitude as number, longitude: longitude as number },
      distanceKm: distanceKm(point, { latitude: latitude as number, longitude: longitude as number }),
    }];
  }).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, limit);
}

export function getFrnswStationProfileUrl(stationNumber: string) {
  return `https://www.fire.nsw.gov.au/contact/fire-station/${encodeURIComponent(stationNumber)}`;
}

export const FRNSW_STATION_FINDER_URL = 'https://www.fire.nsw.gov.au/contact/fire-station';
export const FRNSW_STATION_DATA_URL = STATIONS_SOURCE_LINK;
