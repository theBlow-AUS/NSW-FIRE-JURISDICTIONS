import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const app = resolve('generated-artifacts/standalone/payload/app');
const { createApplication, createGisStore, createLiveFeeds, parseFeed, enrichDangerRatings } = await import(pathToFileURL(join(app, 'server.mjs')));
const sample = { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'source-1', properties: { name: 'Sydney', council: 'Sydney' }, geometry: { type: 'Point', coordinates: [151.2, -33.8] } }] };
const regionsXml = `<FireDangerMap>${Array.from({ length: 20 }, (_, i) => `<District><Name>Region ${i}</Name><RegionNumber>${i}</RegionNumber><Councils>${i ? 'Council ' + i : 'Sydney'}</Councils><DangerLevelToday>HIGH</DangerLevelToday><DangerLevelTomorrow>MODERATE</DangerLevelTomorrow><FireBanToday>No</FireBanToday><FireBanTomorrow>Yes</FireBanTomorrow></District>`).join('')}</FireDangerMap>`;
const rss = (items) => `<rss><channel><lastBuildDate>Tue, 27 Oct 2026 08:56:07 GMT</lastBuildDate>${items}</channel></rss>`;
const incidentXml = rss('<item><title>Test incident</title><guid>incident-1</guid><point xmlns="http://www.georss.org/georss">-33.8 151.2</point><polygon xmlns="http://www.georss.org/georss">-33.8 151.2 -33.8 151.3 -33.9 151.3 -33.8 151.2</polygon><description><![CDATA[ALERT LEVEL: Advice<br/>Updated]]></description></item>');
const dangerRss = rss(Array.from({ length: 20 }, (_, i) => `<item><title>Region ${i}</title><description><![CDATA[REGIONNUMBER: ${i}<br/>COUNCILS: Council ${i}<br/>DANGERLEVELTODAY: HIGH<br/>DANGERLEVELTOMORROW: MODERATE<br/>FIREBANTODAY: No<br/>FIREBANTOMORROW: Yes]]></description></item>`).join(''));
const feedRaw = (url) => url.endsWith('fdrToban.xml') ? regionsXml : url.endsWith('fdrTobanRSS.xml') ? dangerRss :
  url.endsWith('majorIncidents.json') ? JSON.stringify({ ...sample, features: [{ ...sample.features[0], id: 'incident-1', properties: { guid: 'incident-1', title: 'JSON canonical' } }] }) :
  url.endsWith('majorIncidents.xml') ? incidentXml : rss('<item><guid>advisory-1</guid><title>No Major Fires</title><description>No Major Fire Updates.</description></item>');
async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'nsw-gis-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('all five schemas are parsed without inventing advisory coordinates; direct-namespace GeoRSS and polygon footprints are supported', () => {
  const parsed = parseFeed('incidents-xml', incidentXml);
  assert.equal(parsed.features[0].geometry.type, 'GeometryCollection');
  assert.deepEqual(parsed.features[0].geometry.geometries[0].coordinates, [151.2, -33.8]);
  assert.equal(parseFeed('danger-xml', regionsXml).regions.length, 20);
  const rssRegion = parseFeed('danger-rss', dangerRss).regions[0];
  assert.equal(rssRegion.dangerToday, 'HIGH');
  assert.equal(rssRegion.fireBanTomorrow, 'Yes');
  assert.equal(parseFeed('major-updates', rss('<item><title>No fires</title></item>')).features[0].geometry, null);
  assert.throws(() => parseFeed('incidents-xml', '<!DOCTYPE x [<!ENTITY evil SYSTEM "file:///etc/passwd">]><rss/>'), /entities/);
});

test('feeds deduplicate stable incident IDs, persist raw last-good snapshots and retain dated data after a failed scheduled refresh', async (t) => {
  const directory = await temporary(t);
  let fail = false, date = new Date('2026-10-28T00:00:00Z'), calls = 0;
  const feeds = createLiveFeeds({ dataDirectory: directory, now: () => date, fetcher: async (url) => {
    calls += 1;
    if (fail) throw new Error('Offline test');
    return new Response(feedRaw(url), { headers: { etag: '"fixture"', 'last-modified': 'Tue, 27 Oct 2026 08:56:07 GMT' } });
  } });
  await feeds.initialise(); await feeds.refresh();
  assert.equal(calls, 5);
  assert.equal(feeds.read().incidents.features.length, 1);
  assert.equal(feeds.read().incidents.features[0].properties.title, 'JSON canonical');
  await feeds.refresh(true); assert.equal(calls, 5, 'manual refreshes respect the minimum cooldown');
  fail = true; date = new Date('2026-10-28T02:00:00Z'); await feeds.refresh();
  assert.equal(feeds.read().incidents.features.length, 1);
  assert.ok(feeds.read().sources.every((source) => source.stale && /Offline/.test(source.error)));
  const restarted = createLiveFeeds({ dataDirectory: directory, now: () => date });
  await restarted.initialise();
  assert.equal(restarted.read().incidents.features.length, 1);
  assert.equal(restarted.read().sources[0].lastSuccessAt, '2026-10-28T00:00:00.000Z');
});

test('regional enrichment uses exact confirmed names only, with ambiguous and unmatched records reported', () => {
  const regions = parseFeed('danger-xml', regionsXml).regions;
  const source = { ...sample, features: [...sample.features, { ...sample.features[0], properties: { council: 'Sydney suburb' } }] };
  const joined = enrichDangerRatings(source, regions, 'council', []);
  assert.equal(joined.data.features[0].properties._rfsRegion, 'Region 0');
  assert.equal(joined.data.features[1].properties._rfsJoinStatus, 'unmatched');
  assert.equal(joined.provenance.counts.matched, 1);
  assert.equal(enrichDangerRatings(sample, [...regions, regions[0]], 'council', []).data.features[0].properties._rfsJoinStatus, 'ambiguous');
});

test('real local import/edit/export survives restart, leaves sources untouched, rejects invalid coordinates and cross-origin changes', async (t) => {
  const directory = await temporary(t);
  const gis = createGisStore({ dataDirectory: directory }); await gis.initialise();
  const feeds = createLiveFeeds({ dataDirectory: directory, liveFeedsEnabled: false }); await feeds.initialise();
  const server = createApplication({ publicDirectory: join(app, 'public'), gis, feeds, cache: { read: () => ({}) } });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (method, data) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal((await fetch(base + '/workspace')).status, 200);
  const created = await (await fetch(base + '/api/gis/projects', json('POST', { name: 'Local fixture' }))).json();
  const url = `/api/gis/projects/${created.id}`;
  const body = new FormData(); body.append('files', new Blob([JSON.stringify(sample)]), 'sample.geojson');
  const imported = await (await fetch(base + url + '/import', { method: 'POST', body })).json();
  assert.equal(imported.layers.length, 1, JSON.stringify(imported));
  const id = imported.layers[0].id, layerUrl = `${url}/layers/${id}`;
  const working = await (await fetch(base + layerUrl)).json();
  assert.equal(working.crs, 'EPSG:4326');
  working.collection.features[0].properties.name = 'Edited working copy';
  working.collection.features[0].geometry.coordinates = [151.3, -33.7];
  assert.equal((await fetch(base + layerUrl, json('PUT', working))).status, 200);
  const saved = await (await fetch(base + layerUrl)).json();
  assert.equal(saved.collection.features[0].properties.name, 'Edited working copy');
  const exportedResponse = await fetch(base + layerUrl + '/export');
  const exported = await exportedResponse.json();
  assert.equal(exportedResponse.status, 200, JSON.stringify(exported));
  assert.equal(exported.features[0].properties.name, 'Edited working copy');
  assert.ok(!exported.crs);
  const manifest = await (await fetch(base + layerUrl + '/export?manifest=1')).json();
  assert.match(manifest.validation, /GEOS/);
  const disk = JSON.parse(await readFile(join(directory, 'gis-projects', created.id, 'project.json'), 'utf8'));
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'gis-projects', created.id, 'Sources', disk.imports[0].id, 'sample.geojson'), 'utf8')), sample);
  const restarted = createGisStore({ dataDirectory: directory }); await restarted.initialise();
  assert.equal((await restarted.getLayer(created.id, id)).collection.features[0].properties.name, 'Edited working copy');
  working.collection.features[0].geometry.coordinates = [500, -33.7];
  assert.equal((await fetch(base + layerUrl, json('PUT', working))).status, 400);
  assert.equal((await fetch(base + '/api/gis/projects', { ...json('POST', { name: 'Should fail' }), headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' } })).status, 403);
  assert.equal((await fetch(base + layerUrl, { method: 'DELETE' })).status, 200);
  assert.ok((await readdir(join(directory, 'gis-projects', created.id, 'Sources'))).includes(disk.imports[0].id));
  assert.equal((await fetch(base + url, { method: 'DELETE' })).status, 200);
  assert.equal((await readdir(join(directory, 'gis-trash'))).length, 1);
});

test('the bundled engine reads KML, KMZ, a feature-dataset FileGDB directory and a zipped FileGDB, without a GDAL installation', async (t) => {
  const directory = await temporary(t), engine = join(app, 'vendor/gdal');
  const init = createRequire(import.meta.url)(join(engine, 'gdal3.node.js'));
  const Gdal = await init({ path: relative(process.cwd(), engine), dest: directory, logHandler: () => {}, errorHandler: () => {} });
  const source = join(directory, 'sample.geojson'); await writeFile(source, JSON.stringify(sample));
  const dataset = (await Gdal.open(source)).datasets[0];
  const gdb = await Gdal.ogr2ogr(dataset, ['-f', 'OpenFileGDB', '-nln', 'Stations', '-lco', 'FEATURE_DATASET=Operations'], 'sample');
  await Gdal.ogr2ogr(dataset, ['-f', 'OpenFileGDB', '-update', '-nln', 'Second', '-lco', 'FEATURE_DATASET=Operations'], 'sample');
  const kml = await Gdal.ogr2ogr(dataset, ['-f', 'KML'], 'sample');
  await Gdal.close(dataset);
  execFileSync('python3', ['-c', `import pathlib,sys,zipfile
d=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(d/'sample.kmz','w') as z:z.write(d/'sample.kml','doc.kml')
with zipfile.ZipFile(d/'sample.gdb.zip','w') as z:
 for p in (d/'sample.gdb').rglob('*'):
  if p.is_file():z.write(p,p.relative_to(d))`, directory]);
  for (const [index, filename] of [gdb.real, kml.real, join(directory, 'sample.kmz'), join(directory, 'sample.gdb.zip')].entries()) {
    const output = join(directory, `out-${index}`);
    execFileSync(process.execPath, [join(app, 'gis-worker.mjs'), filename, output], { timeout: 60000 });
    const result = JSON.parse(await readFile(join(output, 'result.json'), 'utf8'));
    assert.equal(result.layers.length, index === 0 || index === 3 ? 2 : 1, filename);
  }
});
