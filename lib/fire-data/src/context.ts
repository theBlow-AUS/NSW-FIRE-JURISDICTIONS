import type { FireContext, RfsSnapshot, RfsUpdateStatus } from '@workspace/api-zod';
import { GetRfsSnapshotResponse } from '@workspace/api-zod';
import { scheduledSlots, UPDATE_SCHEDULE } from './schedule';

export const BFDP_SOURCE = 'https://www.rfs.nsw.gov.au/fire-information/BFDP';
export const FCC_SOURCE = 'https://www.rfs.nsw.gov.au/about-us/fire-control-centres';
export const LGA_SOURCE = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Administrative_Boundaries/MapServer/1';
export const FRNSW_SOURCE = 'https://portal.data.nsw.gov.au/arcgis/rest/services/Hosted/FRNSW_Locations/FeatureServer/1';

export function parseRfsSnapshotOutput(value: unknown) {
  return GetRfsSnapshotResponse.parse(value);
}

export function normaliseLga(value: string): string {
  const key = value.toUpperCase().replace(/^CITY OF\s+/, '').replace(/[^A-Z0-9]+/g, ' ').trim()
    .replace(/\s+(?:REGIONAL|CITY|SHIRE|COUNCIL)$/, '').replace(/\s+/g, '');
  return key === 'NAMBUCCAVALLEY' ? 'NAMBUCCA' : key;
}

export function snapshotStatus(snapshot: RfsSnapshot, now = new Date()): RfsUpdateStatus {
  const slots = scheduledSlots(now);
  return {
    permits: {
      sourceUrl: BFDP_SOURCE, retrievedAt: snapshot.permitRetrievedAt, lastAttemptAt: null,
      error: null, stale: new Date(snapshot.permitRetrievedAt) < slots.previous.at,
      recordCount: snapshot.permitRows.length,
    },
    directory: {
      sourceUrl: FCC_SOURCE, retrievedAt: snapshot.contactsRetrievedAt, lastAttemptAt: null,
      error: null, stale: now.getTime() - new Date(snapshot.contactsRetrievedAt).getTime() > 90 * 86400000,
      recordCount: snapshot.contacts.length,
    },
    nextRefreshAt: slots.next.at.toISOString(), schedule: UPDATE_SCHEDULE,
  };
}

export type SpatialContext = Pick<FireContext, 'kind' | 'district' | 'lga' | 'message'>;

export function buildFireContext(spatial: SpatialContext, snapshot: RfsSnapshot, status: RfsUpdateStatus, localCopy = false): FireContext {
  const warnings: string[] = [];
  if (localCopy) warnings.push('This local HTML contains dated embedded RFS data. It does not update in the background; download a newly exported copy for newer data.');
  const rural = spatial.kind === 'rural' && spatial.lga;
  const key = normaliseLga(spatial.lga ?? '');
  const permit = rural ? snapshot.permitRows.find((r) => normaliseLga(r.lga) === key) : undefined;
  const contacts = rural ? snapshot.contacts.filter((c) => normaliseLga(c.lga) === key) : [];
  if (rural) {
    if (!permit) warnings.push('No matching council was found in the RFS permit table. The permit requirement is unavailable, not No.');
    if (!contacts.length) warnings.push('No matching Fire Control Centre is published in this directory snapshot. No contact has been guessed.');
    if (status.permits.stale) warnings.push('The RFS permit snapshot is overdue for refresh. The Yes/No answer below is dated, not a live confirmation.');
    if (status.directory.stale) warnings.push('The contact directory snapshot is over 90 days old. Confirm contact details with NSW RFS.');
    if (status.permits.error) warnings.push('The latest automated RFS refresh failed. The last successful snapshot has been retained.');
    warnings.push('The source reports whether a fire permit is required in RFS districts. This is not an independently verified BFDP declaration or a Total Fire Ban check. A No answer is not permission to burn.');
  }
  return {
    ...spatial, checkedAt: new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Sydney' }),
    permitRequired: permit?.required ?? null, contacts, status, localCopy, warnings,
  };
}
