import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const payload = resolve('generated-artifacts/standalone/payload');
const { createCache } = await import(pathToFileURL(join(payload, 'app/cache.mjs')));
const { createApplication, loadConfiguration } = await import(pathToFileURL(join(payload, 'app/server.mjs')));
const clock = () => new Date('2026-10-23T04:00:00.000Z');

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'nsw-standalone-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('new configuration is local, valid, and preserved on subsequent launches', async (t) => {
  const directory = await fixture(t);
  const filename = join(directory, 'server.json');
  const defaults = join(payload, 'config/server.default.json');
  const config = await loadConfiguration(filename, defaults);
  assert.equal(config.port, 8080);
  assert.equal(config.dataDirectory, join(directory, 'data'));
  await writeFile(filename, JSON.stringify({ ...config, port: 8123 }));
  assert.equal((await loadConfiguration(filename, defaults)).port, 8123);
  await writeFile(filename, JSON.stringify({ ...config, port: 0 }));
  await assert.rejects(loadConfiguration(filename, defaults), /port/);
});

test('failed refresh retains source dates and rows, records warning, and runs only once per due slot across restarts', async (t) => {
  const directory = await fixture(t);
  let calls = 0;
  const scrape = async () => { calls += 1; throw new Error('RFS blocked automated access (HTTP 403).'); };
  const cache = createCache({ dataDirectory: directory, now: clock, scrape });
  await cache.initialise();
  const original = cache.read().snapshot;
  assert.equal(await cache.refresh(), false);
  assert.equal(await cache.refresh(), true);
  assert.equal(calls, 1);
  assert.deepEqual(cache.read().snapshot, original);
  assert.match(cache.read().status.permits.error, /403/);
  const restarted = createCache({ dataDirectory: directory, now: clock, scrape });
  await restarted.initialise();
  assert.equal(await restarted.refresh(), true);
  assert.equal(calls, 1);
  assert.match(restarted.read().status.permits.error, /403/);
});

test('successful refresh persists rows and a fresh source date', async (t) => {
  const directory = await fixture(t);
  const seed = createCache({ dataDirectory: directory, now: clock });
  await seed.initialise();
  const rows = seed.read().snapshot.permitRows.map((row) => ({ ...row, required: !row.required }));
  const cache = createCache({ dataDirectory: directory, now: clock, scrape: async () => rows });
  await cache.initialise();
  assert.equal(await cache.refresh(), true);
  assert.deepEqual(cache.read().snapshot.permitRows, rows);
  assert.equal(cache.read().status.permits.retrievedAt, clock().toISOString());
  assert.equal(cache.read().status.permits.error, null);
  const restarted = createCache({ dataDirectory: directory, now: clock });
  await restarted.initialise();
  assert.deepEqual(restarted.read().snapshot.permitRows, rows);
});

test('simultaneous scheduled checks share one scrape and an incomplete response cannot replace data', async (t) => {
  const directory = await fixture(t);
  let calls = 0;
  const cache = createCache({ dataDirectory: directory, now: clock, scrape: async () => {
    calls += 1;
    await new Promise((done) => setTimeout(done, 10));
    return [{ lga: 'Incomplete', required: false }];
  } });
  await cache.initialise();
  const original = cache.read().snapshot;
  await Promise.all([cache.refresh(), cache.refresh(), cache.refresh()]);
  assert.equal(calls, 1);
  assert.deepEqual(cache.read().snapshot, original);
  assert.match(cache.read().status.permits.error, /incomplete/);
});

test('damaged cache is preserved and produces a visible fallback warning', async (t) => {
  const directory = await fixture(t);
  await writeFile(join(directory, 'rfs-cache.json'), '{broken');
  const cache = createCache({ dataDirectory: directory, now: clock });
  await cache.initialise();
  assert.ok((await readdir(directory)).some((filename) => filename.includes('.invalid-')));
  assert.match(cache.read().status.permits.error, /invalid/);
  assert.ok(cache.read().snapshot.permitRows.length >= 100);
});

test('refreshes run on month end, month start and Monday, while disabled updates are visibly reported', async (t) => {
  const directory = await fixture(t);
  let date = new Date('2026-10-30T17:00:00Z'); // 31 October, 4 am Sydney.
  let calls = 0;
  const cache = createCache({ dataDirectory: directory, updaterEnabled: false, now: () => date, scrape: async () => {
    calls += 1;
    throw new Error('Test source blocked.');
  } });
  await cache.initialise();
  assert.match(cache.read().status.permits.error, /updater is disabled/);
  await cache.refresh();
  await cache.refresh();
  assert.equal(calls, 1);
  date = new Date('2026-10-31T17:00:00Z'); // First of November.
  await cache.refresh();
  assert.equal(calls, 2);
  date = new Date('2026-11-01T17:00:00Z'); // Monday 2 November.
  await cache.refresh();
  assert.equal(calls, 3);
});

test('local HTTP server exposes the real UI/API and preserves FRNSW priority without Replit or a database', async (t) => {
  const directory = await fixture(t);
  const cache = createCache({ dataDirectory: directory, now: clock });
  await cache.initialise();
  const server = createApplication({
    publicDirectory: join(payload, 'app/public'), cache,
    spatialLookup: async () => ({ kind: 'frnsw', district: 'Sydney', lga: 'BATHURST REGIONAL', message: null }),
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base);
  const html = await page.text();
  assert.match(html, /NSW Fire District Checker/);
  assert.doesNotMatch(html, /replit\.(com|dev|app)|\/@vite|fonts\.googleapis/);
  assert.match(page.headers.get('Content-Security-Policy'), /connect-src 'self' https:\/\/maps\.six\.nsw\.gov\.au/);
  assert.doesNotMatch(page.headers.get('Content-Security-Policy'), /replit/);
  const script = html.match(/src="([^"]+\.js)"/)[1];
  assert.equal((await fetch(base + script)).status, 200);
  assert.deepEqual(await (await fetch(base + '/api/healthz')).json(), { status: 'ok' });
  const result = await (await fetch(base + '/api/fire-context?latitude=-33.8688&longitude=151.2093')).json();
  assert.equal(result.kind, 'frnsw');
  assert.equal(result.permitRequired, null);
  assert.deepEqual(result.contacts, []);
  assert.equal(result.localCopy, false);
  assert.equal((await fetch(base + '/api/rfs/snapshot')).status, 200);
  assert.equal((await fetch(base + '/api/rfs/status')).status, 200);
  assert.equal((await fetch(base + '/api/fire-context?latitude=oops&longitude=151')).status, 400);
  assert.equal((await fetch(base + '/api/fire-context?latitude=91&longitude=151')).status, 400);
  assert.equal((await fetch(base + '/api/unknown')).status, 404);
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/%2e%2e%2fserver.mjs')).status, 400);
  assert.equal((await fetch(base + '/server.mjs')).status, 404);
});

test('packaged assets contain no Replit/development or remote-font connections and have a complete manifest', async () => {
  const manifest = JSON.parse(await readFile(join(payload, 'BUILD-MANIFEST.json'), 'utf8'));
  assert.equal(manifest.architecture, 'x64');
  assert.ok(manifest.files.some((file) => file.path === 'runtime/node.exe'));
  assert.ok(manifest.files.some((file) => file.path === 'NSWFireCoverage.exe'));
  for (const file of manifest.files.filter((file) => /\.(html|js|mjs|css)$/.test(file.path))) {
    const content = await readFile(join(payload, file.path), 'utf8');
    assert.equal(createHash('sha256').update(content).digest('hex'), file.sha256);
    assert.doesNotMatch(content, /https?:\/\/[^"'\s<>]*(?:replit\.(?:com|app|dev)|repl\.co)|\/@vite\/client|fonts\.googleapis\.com|fonts\.gstatic\.com/);
  }
});

test('MSI installs an automatic LocalService service and grants only local data access before startup', async () => {
  const filename = resolve(`generated-artifacts/standalone/NSW-Fire-Coverage-${process.env.INSTALLER_VERSION || '1.1.0'}-x64.msi`);
  const table = (name) => execFileSync('msiinfo', ['export', filename, name], { encoding: 'utf8' });
  const service = table('ServiceInstall');
  assert.match(service, /NSWFireCoverage/);
  assert.match(service, /NT AUTHORITY\\LocalService/);
  assert.match(table('ServiceControl'), /NSWFireCoverage/);
  const actions = table('CustomAction');
  assert.match(actions, /S-1-5-19/);
  assert.match(actions, /GrantLocalServiceDataAccess/);
  const sequence = table('InstallExecuteSequence').trim().split(/\r?\n/).slice(3).map((line) => line.split('\t'));
  const position = (name) => Number(sequence.find((row) => row[0] === name)?.[2]);
  assert.ok(position('GrantLocalServiceDataAccess') > position('InstallFiles'));
  assert.ok(position('GrantLocalServiceDataAccess') < position('StartServices'));
  assert.ok(position('ConfigureServiceRecovery') > position('InstallServices'));
  assert.ok(position('ConfigureServiceFailureFlag') < position('StartServices'));
  assert.ok(position('StopServices') < position('DeleteServices'));
  assert.match(table('LaunchCondition'), /VersionNT64/);
});
