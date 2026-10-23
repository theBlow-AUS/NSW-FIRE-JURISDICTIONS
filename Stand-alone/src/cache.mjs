import { mkdir, readFile, rename, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseRfsSnapshotOutput, seedSnapshot, snapshotStatus, scheduledSlots } from '@workspace/fire-data';
import { scrapePermitTable } from '@standalone/rfs-scrape';

export function log(level, message, details = {}) {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, message, ...details })}\n`);
}

export function createCache({ dataDirectory, updaterEnabled = true, initialSnapshot = seedSnapshot, scrape = scrapePermitTable, now = () => new Date() }) {
  const filename = join(dataDirectory, 'rfs-cache.json');
  let state;
  let inFlight = null;
  let timer;
  let storageError = null;

  function output() {
    if (!state) throw new Error('Local RFS cache has not been initialised.');
    const status = snapshotStatus(state.snapshot, now());
    status.permits.lastAttemptAt = state.lastAttemptAt;
    status.permits.error = [
      state.lastError, storageError,
      updaterEnabled ? null : 'The local updater is disabled in server configuration. Dated data is being shown.',
    ].filter(Boolean).join(' ') || null;
    if (!updaterEnabled) status.schedule = `Updater disabled in local configuration. Scheduled dates if enabled: ${status.schedule}`;
    return { snapshot: structuredClone(state.snapshot), status };
  }

  async function save() {
    const temporary = `${filename}.${randomUUID()}.tmp`;
    // Same-directory rename avoids exposing partially written JSON after a crash.
    await writeFile(temporary, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, filename);
  }

  async function initialise() {
    await mkdir(dataDirectory, { recursive: true });
    try {
      const disk = JSON.parse(await readFile(filename, 'utf8'));
      const validated = parseRfsSnapshotOutput({ snapshot: disk.snapshot, status: snapshotStatus(disk.snapshot, now()) });
      for (const field of ['lastAttemptAt', 'lastRunDate', 'lastError']) {
        if (disk[field] !== null && typeof disk[field] !== 'string') throw new Error(`Invalid cache field ${field}.`);
      }
      if (disk.lastRunDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(disk.lastRunDate)) throw new Error('Invalid last scheduled date.');
      state = { snapshot: validated.snapshot, lastAttemptAt: disk.lastAttemptAt, lastRunDate: disk.lastRunDate, lastError: disk.lastError };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        // Keep the damaged original for an administrator instead of silently destroying it.
        await copyFile(filename, `${filename}.invalid-${Date.now()}`);
        storageError = 'The saved local RFS cache was invalid. A dated bundled snapshot is being used; the original file was preserved for the administrator.';
        log('warn', storageError);
      }
      state = {
        snapshot: structuredClone(initialSnapshot),
        lastAttemptAt: null,
        lastRunDate: null,
        lastError: 'No successful refresh has run on this installation yet. The dated bundled snapshot is being shown.',
      };
      await save();
    }
    return output();
  }

  async function refresh(force = false) {
    if (inFlight) return inFlight;
    const slot = scheduledSlots(now()).previous;
    if (!force && state.lastRunDate && state.lastRunDate >= slot.date) return true;
    inFlight = (async () => {
      state.lastRunDate = slot.date;
      state.lastAttemptAt = now().toISOString();
      // Persist the attempt before making the call so a blocked service is not retried every minute.
      await save();
      try {
        const rows = await scrape();
        const nextSnapshot = { ...state.snapshot, permitRows: rows, permitRetrievedAt: now().toISOString() };
        const next = parseRfsSnapshotOutput({ snapshot: nextSnapshot, status: snapshotStatus(nextSnapshot, now()) });
        if (next.snapshot.permitRows.length < 100) throw new Error('The permit response was incomplete; the last snapshot is retained.');
        state.snapshot = next.snapshot;
        state.lastError = null;
        await save();
        storageError = null;
        log('info', 'Local RFS permit snapshot refreshed', { records: rows.length, scheduledDate: slot.date });
        return true;
      } catch (error) {
        state.lastError = error instanceof Error ? error.message : 'RFS refresh failed. The last successful snapshot is retained.';
        await save();
        log('warn', 'RFS refresh failed; retaining the last snapshot', { error: state.lastError });
        return false;
      }
    })();
    try {
      return await inFlight;
    } catch (error) {
      storageError = 'The local cache could not be saved. Check the service account permissions and available disk space.';
      log('error', storageError, { error: error.message });
      throw error;
    } finally {
      inFlight = null;
    }
  }

  function start() {
    const check = () => { void refresh().catch(() => {}); };
    check();
    timer = setInterval(check, 60000);
    timer.unref();
  }

  return { initialise, read: output, refresh, start, stop: () => clearInterval(timer) };
}
