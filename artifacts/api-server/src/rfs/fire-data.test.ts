import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFireContext, seedSnapshot, scheduledSlots, snapshotStatus, normaliseLga } from '@workspace/fire-data';
import { parsePermitTable } from './scrape';

test('FRNSW overrides every RFS permit and contact record', () => {
  const ctx = buildFireContext({ kind: 'frnsw', district: 'Sydney', lga: 'BATHURST REGIONAL', message: null },
    seedSnapshot, snapshotStatus(seedSnapshot));
  assert.equal(ctx.permitRequired, null);
  assert.deepEqual(ctx.contacts, []);
  assert.equal(ctx.kind, 'frnsw');
});

test('a missing RFS record is unknown, not a No answer', () => {
  const ctx = buildFireContext({ kind: 'rural', district: null, lga: 'UNKNOWN LGA', message: null },
    seedSnapshot, snapshotStatus(seedSnapshot));
  assert.equal(ctx.permitRequired, null);
  assert.ok(ctx.warnings.some((w) => w.includes('unavailable, not No')));
});

test('published No answers survive and have contact provenance', () => {
  const ctx = buildFireContext({ kind: 'rural', district: null, lga: 'ALBURY', message: null },
    seedSnapshot, snapshotStatus(seedSnapshot));
  assert.equal(ctx.permitRequired, false);
  assert.ok(ctx.contacts.length > 0);
  assert.ok(ctx.warnings.some((w) => w.includes('not permission to burn')));
});

test('failed FRNSW checks never expose RFS data', () => {
  const ctx = buildFireContext({ kind: 'error', district: null, lga: 'BATHURST REGIONAL', message: 'Boundary failed' },
    seedSnapshot, snapshotStatus(seedSnapshot));
  assert.equal(ctx.permitRequired, null);
  assert.deepEqual(ctx.contacts, []);
});

test('LGA aliases are explicit and permit rows have no canonical collisions', () => {
  assert.equal(normaliseLga('City of Parramatta'), normaliseLga('PARRAMATTA'));
  assert.equal(normaliseLga('Nambucca Valley'), normaliseLga('NAMBUCCA'));
  assert.equal(new Set(seedSnapshot.permitRows.map((p) => normaliseLga(p.lga))).size, seedSnapshot.permitRows.length);
  assert.ok(seedSnapshot.contacts.every((c) => c.address && c.phone && c.district));
});

test('the weekly run and month-boundary runs are all retained', () => {
  const a = scheduledSlots(new Date('2026-10-30T17:00:00Z'));
  assert.equal(a.previous.date, '2026-10-31');
  assert.equal(a.next.date, '2026-11-01');
  const b = scheduledSlots(a.next.at);
  assert.equal(b.next.date, '2026-11-02');
  assert.equal(b.next.at.toISOString(), '2026-11-01T16:00:00.000Z');
});

test('leap years and coinciding Monday/month-first dates run correctly', () => {
  assert.equal(scheduledSlots(new Date('2028-02-28T17:00:00Z')).previous.date, '2028-02-29');
  const slot = scheduledSlots(new Date('2027-01-31T15:59:00Z')).next;
  assert.equal(slot.date, '2027-02-01');
  assert.equal(scheduledSlots(slot.at).next.date, '2027-02-08');
});

test('Sydney daylight saving changes retain 3 am local scheduling', () => {
  for (const instant of ['2026-10-03T23:00:00Z', '2027-04-04T00:00:00Z']) {
    const slot = scheduledSlots(new Date(instant)).next;
    const hour = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', hourCycle: 'h23' }).format(slot.at);
    assert.equal(Number(hour), 3);
  }
});

test('scraper accepts the labelled permit table and preserves No values', () => {
  const html = `<table><tr><th>Council name</th><th>Fire Permit required</th></tr>${seedSnapshot.permitRows.map((r) =>
    `<tr><td>${r.lga}</td><td>${r.required ? 'Yes' : 'No'}</td></tr>`).join('')}</table>`;
  assert.deepEqual(parsePermitTable(html), seedSnapshot.permitRows);
});

test('scraper fails closed on challenges, incomplete data and unexpected values', () => {
  assert.throws(() => parsePermitTable('<html><h1>Just a moment</h1></html>'));
  assert.throws(() => parsePermitTable('<table><tr><th>Council name</th><th>Fire Permit required</th></tr><tr><td>Test</td><td>Unknown</td></tr></table>'));
  assert.throws(() => parsePermitTable('<table><tr><th>Council name</th><th>Fire Permit required</th></tr><tr><td>Test</td><td>No</td></tr></table>'));
});

test('an overdue local snapshot is explicitly marked dated and stale', () => {
  const status = snapshotStatus(seedSnapshot, new Date('2030-05-01T00:00:00Z'));
  assert.equal(status.permits.stale, true);
  const ctx = buildFireContext({ kind: 'rural', lga: 'BATHURST REGIONAL', district: null, message: null }, seedSnapshot, status, true);
  assert.ok(ctx.warnings.some((w) => w.includes('does not update in the background')));
  assert.ok(ctx.warnings.some((w) => w.includes('overdue')));
});
