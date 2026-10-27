import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { collectionFeatures, writeCollection, MAX_FEATURE_BYTES } from '../src/gis-stream.mjs';
import { openIndex, queryAttributes, queryPreview } from '../src/gis-index.mjs';

const app = resolve(process.env.GIS_TEST_APP_DIR || 'generated-artifacts/standalone/payload/app');
const { createGisStore, createApplication, enrichDangerRatings } = await import(pathToFileURL(join(app, 'server.mjs')));
const point = (i) => ({ type: 'Feature', id: i % 2 ? 'duplicate-id' : i, properties: { name: `Record ${i}`, council: 'Sydney' },
  geometry: i % 10 === 0 ? null : { type: 'Point', coordinates: [150 + (i % 100) / 100, -34 + Math.floor(i / 100) / 10000] } });
const options = (layer, edits = []) => ({ revision: layer.revision, name: layer.name, style: layer.style, visible: layer.visible, edits });
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'gis-large-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const gis = createGisStore({ dataDirectory: directory }); await gis.initialise();
  const project = await gis.create('Large regression');
  const collection = { type: 'FeatureCollection', features: Array.from({ length: 12050 }, (_, i) => point(i)) };
  const bytes = JSON.stringify(collection), fd = new FormData();
  fd.append('files', new Blob([bytes]), 'large.geojson');
  fd.append('files', new Blob([JSON.stringify({ type: 'FeatureCollection', features: [point(1)] })]), 'second.geojson');
  const request = new Request('http://localhost/', { method: 'POST', body: fd });
  const stream = Readable.fromWeb(request.body); stream.headers = Object.fromEntries(request.headers);
  const imported = await gis.importFiles(project.id, stream);
  assert.equal(imported.layers.length, 2, JSON.stringify(imported.warnings));
  const id = imported.layers[0].id, layer = await gis.getLayer(project.id, id);
  return { gis, directory, project, layer, id, bytes };
}

test('stream scanner handles chunk boundaries, escaped delimiters, Unicode, Feature input and rejects malformed envelopes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gis-parser-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'source.json');
  const feature = { ...point(1), properties: { name: 'é'.repeat(80000) + '"},\\" ] [' } };
  await writeCollection(file, [feature]);
  const found = [];
  for await (const f of collectionFeatures(file)) found.push(f);
  assert.deepEqual(found, [feature]);
  await writeFile(file, JSON.stringify(feature));
  for await (const f of collectionFeatures(file)) assert.deepEqual(f, feature);
  for (const raw of ['{"type":"FeatureCollection","features":[{},]}', '{"type":"FeatureCollection","features":[]}false',
    '{"features":[]}', '{"type":"FeatureCollection","features":[],"crs":{}}',
    '{"type":"FeatureCollection","features":[],"type":"FeatureCollection"}']) {
    await writeFile(file, raw);
    await assert.rejects(async () => { for await (const _ of collectionFeatures(file)) {} });
  }
  await writeFile(file, JSON.stringify({ type: 'FeatureCollection', features: [{ ...point(1), properties: { huge: 'x'.repeat(MAX_FEATURE_BYTES) } }] }));
  await assert.rejects(async () => { for await (const _ of collectionFeatures(file)) {} }, /8 MiB/);
});

test('pagination and viewport caps cannot truncate exports; sparse edits outside previews survive restart and provenance retains all records', async (t) => {
  const { gis, directory, project, layer, id, bytes } = await fixture(t);
  assert.equal(layer.featureCount, 12050); assert.equal(layer.collection.features.length, 1000); assert.equal(layer.truncated, true);
  const page = await gis.attributes(project.id, id, { offset: 11950, limit: 100, search: '' });
  assert.equal(page.items.length, 100); assert.equal(page.nextOffset, null); assert.equal(page.items[99].ordinal, 12049);
  assert.equal(page.items[99].feature.geometry, null, 'attribute pages do not return geometry');
  const search = await gis.attributes(project.id, id, { search: 'Record 12049' });
  assert.equal(search.total, 1); assert.equal(search.items[0].ordinal, 12049);
  const feature = (await gis.feature(project.id, id, 12049)).feature;
  feature.properties.name = 'Edited beyond preview'; feature.geometry = { type: 'Point', coordinates: [152, -32] };
  const saved = await gis.patchLayer(project.id, id, options(layer, [{ ordinal: 12049, feature }]));
  const moved = await gis.getLayer(project.id, id, [151.99, -32.01, 152.01, -31.99]);
  assert.deepEqual(moved.ordinals, [12049]); assert.equal(moved.collection.features[0].properties.name, 'Edited beyond preview');
  assert.equal((await gis.getLayer(project.id, id, [149, -35, 151, -33])).ordinals.includes(12049), false);
  await assert.rejects(gis.patchLayer(project.id, id, options(layer, [{ ordinal: 12049, feature: point(12049) }])), /changed/);
  const restarted = createGisStore({ dataDirectory: directory }); await restarted.initialise();
  assert.equal((await restarted.feature(project.id, id, 12049)).feature.properties.name, 'Edited beyond preview');
  const exported = await restarted.exportLayer(project.id, id, (data) => enrichDangerRatings(data, [{ name: 'Fixture region', councils: ['Sydney'], dangerToday: 'HIGH' }], 'council', []));
  let count = 0, last;
  for await (const f of collectionFeatures(exported.path)) { count++; last = f; }
  assert.equal(count, 12050); assert.equal(last.properties.name, 'Edited beyond preview');
  assert.deepEqual(last.geometry.coordinates, [152, -32]);
  assert.equal(exported.manifest.layer.revision, saved.revision);
  assert.equal(exported.manifest.layer.featureCount, count);
  assert.equal(exported.manifest.regionalEnrichment.counts.matched, 12050);
  assert.equal(last.properties._rfsRegion, 'Fixture region');
  assert.equal(exported.manifest.sourceManifest, `Sources/${layer.importId}.manifest.json`);
  const source = await readFile(join(directory, 'gis-projects', project.id, 'Sources', layer.importId, 'large.geojson'));
  assert.equal(createHash('sha256').update(source).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
  assert.ok((await stat(exported.path)).size > 12050 * 70);
});

test('invalid multi-edit transactions roll back every edit, stable ordinals disambiguate duplicate source IDs, styles do not rewrite sources', async (t) => {
  const { gis, project, layer, id } = await fixture(t);
  const valid = point(1); valid.properties.name = 'Must roll back';
  const invalid = point(3); invalid.geometry.coordinates = [999, 0];
  await assert.rejects(gis.patchLayer(project.id, id, options(layer, [{ ordinal: 1, feature: valid }, { ordinal: 3, feature: invalid }])), /WGS84/);
  assert.equal((await gis.feature(project.id, id, 1)).feature.properties.name, 'Record 1');
  const changed = await gis.patchLayer(project.id, id, { ...options(layer), visible: false });
  assert.equal(changed.featureCount, 12050); assert.equal(changed.visible, false);
  await assert.rejects(gis.patchLayer(project.id, id, options(changed, [{ ordinal: 1, feature: valid }, { ordinal: 1, feature: valid }])), /duplicate/);
  assert.throws(() => gis.saveLayer(project.id, id, { collection: layer.collection }), /Whole-layer/);
});

test('byte budgets bound dense previews and attribute pages independently of row counts', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gis-bytes-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const { buildIndex } = await import('../src/gis-index.mjs');
  const file = join(directory, 'large.json');
  const features = Array.from({ length: 8 }, (_, i) => ({ ...point(i + 1), properties: { huge: 'x'.repeat(600000) } }));
  await writeCollection(file, features);
  const dbFile = join(directory, 'index.sqlite');
  await buildIndex(file, dbFile, (v) => v);
  const db = openIndex(dbFile);
  try {
    const preview = queryPreview(db, [149, -35, 152, -32]);
    assert.ok(preview.collection.features.length <= 3); assert.equal(preview.truncated, true);
    const page = queryAttributes(db);
    assert.equal(page.items.length, 3); assert.equal(page.nextOffset, 3);
    assert.equal(queryAttributes(db, { offset: page.nextOffset }).items[0].ordinal, 3);
  } finally { db.close(); }
});

test('HTTP page and sparse-edit contracts work without whole-layer payloads', async (t) => {
  const { gis, project, layer, id } = await fixture(t);
  const server = createApplication({ publicDirectory: join(app, 'public'), gis, feeds: { read: () => ({ sources: [], dangerRegions: [] }) }, cache: { read: () => ({}) } });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}/api/gis/projects/${project.id}/layers/${id}`;
  const page = await (await fetch(base + '/attributes?offset=12000&limit=50')).json();
  assert.equal(page.items.length, 50);
  const feature = (await (await fetch(base + '/features/12049')).json()).feature;
  feature.properties.name = 'HTTP sparse edit';
  const payload = JSON.stringify(options(layer, [{ ordinal: 12049, feature }]));
  assert.ok(payload.length < 1000);
  const response = await fetch(base, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: payload });
  assert.equal(response.status, 200, await response.text());
  const preview = await (await fetch(base + '?bbox=150.48,-33.989,150.50,-33.987')).json();
  assert.ok(preview.collection.features.length < 1000);
  assert.equal((await fetch(base + '/attributes?limit=100000')).status, 400);
  assert.equal((await fetch(base + '?bbox=not-a-bbox')).status, 400);
  assert.equal((await fetch(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 410);
});

test('topologically invalid geometry blocks publication and missing edited indexes never silently revert saved edits', async (t) => {
  const { gis, project, layer, id, directory } = await fixture(t);
  const feature = point(1);
  feature.geometry = { type: 'Polygon', coordinates: [[[150, -34], [151, -33], [150, -33], [151, -34], [150, -34]]] };
  await gis.patchLayer(project.id, id, options(layer, [{ ordinal: 1, feature }]));
  await assert.rejects(gis.exportLayer(project.id, id), /invalid geometr/);
  assert.deepEqual(await readdir(join(directory, 'gis-projects', project.id, 'Exports')), []);
  await rm(join(directory, 'gis-projects', project.id, 'Working', `${id}.sqlite`));
  await assert.rejects(gis.getLayer(project.id, id), /index is missing/);
});

test('legacy working layers index lazily and projected GeoJSON reprojects even when its CRS follows features', async (t) => {
  const { gis, directory, project, layer, id } = await fixture(t);
  await rm(join(directory, 'gis-projects', project.id, 'Working', `${id}.sqlite`));
  const migrated = await gis.getLayer(project.id, id);
  assert.equal(migrated.featureCount, layer.featureCount);
  assert.equal(migrated.collection.features.length, 1000);
  const source = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Projected source' },
    geometry: { type: 'Point', coordinates: [16832501, -4010998] } }], crs: { type: 'name', properties: { name: 'EPSG:3857' } } };
  const fd = new FormData(); fd.append('files', new Blob([JSON.stringify(source)]), 'projected.geojson');
  const req = new Request('http://localhost/', { method: 'POST', body: fd });
  const stream = Readable.fromWeb(req.body); stream.headers = Object.fromEntries(req.headers);
  const imported = await gis.importFiles(project.id, stream);
  assert.equal(imported.layers.length, 1, JSON.stringify(imported.warnings));
  const record = await gis.feature(project.id, imported.layers[0].id, 0);
  assert.ok(Math.abs(record.feature.geometry.coordinates[0] - 151.21) < 0.01);
  assert.ok(Math.abs(record.feature.geometry.coordinates[1] + 33.87) < 0.01);
});
