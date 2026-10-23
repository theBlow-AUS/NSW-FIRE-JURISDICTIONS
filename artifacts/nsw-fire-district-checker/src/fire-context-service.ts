import { getFireContext, type FireContext } from '@workspace/api-client-react';
import { buildFireContext, lookupSpatialContext, parseRfsSnapshotOutput, seedSnapshot, snapshotStatus } from '@workspace/fire-data';
import type { MapPoint } from './MapPanel';

export async function loadFireContext(point: MapPoint): Promise<FireContext> {
  if (window.location.protocol === 'file:') {
    const embedded = document.getElementById('rfs-embedded-snapshot');
    const exported = embedded ? parseRfsSnapshotOutput(JSON.parse(embedded.textContent ?? '')) : null;
    const snapshot = exported?.snapshot ?? seedSnapshot;
    const status = snapshotStatus(snapshot);
    status.permits.lastAttemptAt = exported?.status.permits.lastAttemptAt ?? null;
    status.permits.error = exported?.status.permits.error ?? null;
    const spatial = await lookupSpatialContext(point.latitude, point.longitude);
    return buildFireContext(spatial, snapshot, status, true);
  }
  return getFireContext(point, { signal: AbortSignal.timeout(45000) });
}
