import { db, pool, rfsCacheTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { seedSnapshot, snapshotStatus, scheduledSlots } from '@workspace/fire-data';
import type { RfsSnapshotOutput } from '@workspace/api-zod';
import { logger } from '../lib/logger';
import { scrapePermitTable } from './scrape';

const CACHE_ID = 'official-rfs-bfdp';
const LOCK_ID = 17927206;

export async function initialiseRfsCache(): Promise<void> {
  await db.insert(rfsCacheTable).values({
    id: CACHE_ID, records: seedSnapshot.permitRows, retrievedAt: new Date(seedSnapshot.permitRetrievedAt),
  }).onConflictDoNothing();
}

export async function readRfsSnapshot(): Promise<RfsSnapshotOutput> {
  try {
    const [row] = await db.select().from(rfsCacheTable).where(eq(rfsCacheTable.id, CACHE_ID));
    if (!row) throw new Error('No persisted snapshot is available.');
    const snapshot = { ...seedSnapshot, permitRows: row.records, permitRetrievedAt: row.retrievedAt.toISOString() };
    const status = snapshotStatus(snapshot);
    status.permits.lastAttemptAt = row.lastAttemptAt?.toISOString() ?? null;
    status.permits.error = row.lastError;
    return { snapshot, status };
  } catch (error) {
    logger.warn({ err: error }, 'RFS cache unavailable; using the dated bundled snapshot');
    const status = snapshotStatus(seedSnapshot);
    status.permits.error = 'The hosted cache is unavailable. A dated bundled snapshot is being shown.';
    return { snapshot: seedSnapshot, status };
  }
}

export async function refreshRfsIfDue(force = false): Promise<boolean> {
  const client = await pool.connect();
  let locked = false;
  let attempted = false;
  try {
    const result = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_ID]);
    locked = result.rows[0]?.locked ?? false;
    if (!locked) return true;
    const [row] = await db.select().from(rfsCacheTable).where(eq(rfsCacheTable.id, CACHE_ID));
    if (!row) throw new Error('RFS cache must be initialised before refreshing.');
    const slot = scheduledSlots().previous;
    if (!force && row.lastRunDate && row.lastRunDate >= slot.date) return true;
    await db.update(rfsCacheTable).set({ lastAttemptAt: new Date(), lastRunDate: slot.date })
      .where(eq(rfsCacheTable.id, CACHE_ID));
    attempted = true;
    const records = await scrapePermitTable();
    await db.update(rfsCacheTable).set({ records, retrievedAt: new Date(), lastError: null })
      .where(eq(rfsCacheTable.id, CACHE_ID));
    logger.info({ count: records.length, scheduledDate: slot.date }, 'RFS permit snapshot refreshed');
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RFS refresh failed. Cached data is retained.';
    logger.warn({ err: error }, 'RFS refresh failed; retaining the last successful snapshot');
    if (attempted) await db.update(rfsCacheTable).set({ lastError: message }).where(eq(rfsCacheTable.id, CACHE_ID));
    return false;
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
    } finally {
      client.release();
    }
  }
}

export function startRfsUpdater(): void {
  const check = () => { void refreshRfsIfDue().catch((err) => logger.error({ err }, 'RFS scheduled check failed')); };
  check();
  // The database date and advisory lock prevent duplicate scrapes across restarts or replicas.
  setInterval(check, 60000).unref();
}
