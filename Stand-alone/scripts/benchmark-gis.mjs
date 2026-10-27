// Run after build.mjs --shared-only. Outputs stay in ignored generated-artifacts.
import { createRequire } from 'node:module';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { collectionFeatures, writeCollection } from '../src/gis-stream.mjs';

const execute = promisify(execFile);
const count = Number(process.argv[2] || 100000);
if (!Number.isSafeInteger(count) || count < 100 || count > 2000000) throw new Error('Use 100–2,000,000 records per layer.');
const app = resolve(process.env.GIS_TEST_APP_DIR || 'generated-artifacts/standalone-macos/shared/payload/app');
const root = resolve(`generated-artifacts/gis-benchmark/${count}`);
await mkdir(root, { recursive: true });
const point = (i) => [150 + (i % 1000) * 0.001, -34 + Math.floor(i / 1000) * 0.001];
function* features(polygon) {
  for (let i = 0; i < count; i++) {
    const [x, y] = point(i), s = 0.0003;
    yield { type: 'Feature', id: i, properties: { name: `Generated record ${i}`, council: 'Sydney', payload: 'x'.repeat(64) },
      geometry: polygon ? { type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] } : { type: 'Point', coordinates: [x, y] } };
  }
}
if (process.argv.includes('--generate')) {
  for (const name of ['points', 'polygons']) {
    const file = join(root, `${name}.geojson`);
    await rm(file, { force: true }); await writeCollection(file, features(name === 'polygons'));
  }
  const require = createRequire(import.meta.url), engine = join(app, 'vendor/gdal');
  const init = require(join(engine, 'gdal3.node.js'));
  const Gdal = await init({ path: relative(process.cwd(), engine).replaceAll('\\', '/'), dest: root, logHandler: () => {}, errorHandler: () => {} });
  await rm(join(root, 'source.gdb'), { recursive: true, force: true });
  for (const name of ['points', 'polygons']) {
    const dataset = (await Gdal.open(join(root, `${name}.geojson`).replaceAll('\\', '/'))).datasets[0];
    await Gdal.ogr2ogr(dataset, ['-f', 'OpenFileGDB', '-nln', name, ...(name === 'polygons' ? ['-update'] : [])], 'source');
    await Gdal.close(dataset);
  }
  console.log(JSON.stringify({ generationPeakRssMiB: process.resourceUsage().maxRSS / 1024 }));
  process.exit(0);
}

const generated = await execute(process.execPath, [process.argv[1], String(count), '--generate'], { timeout: 15 * 60000, maxBuffer: 1024 ** 2 });
const conversionRuns = [];
async function converter(source, output, strict) {
  const start = performance.now();
  await execute(process.execPath, [join(app, 'gis-worker.mjs'), source, output, ...(strict ? ['--validate'] : [])],
    { timeout: 15 * 60000, maxBuffer: 1024 ** 2 });
  const result = JSON.parse(await readFile(join(output, 'result.json'), 'utf8'));
  conversionRuns.push({ seconds: (performance.now() - start) / 1000, peakRssMiB: result.resources?.peakRssMiB, validation: Boolean(strict) });
  return result;
}
const { createGisStore } = await import(pathToFileURL(join(app, 'server.mjs')));
const dataDirectory = join(root, 'data');
await rm(dataDirectory, { recursive: true, force: true });
const gis = createGisStore({ dataDirectory, converter }); await gis.initialise();
const project = await gis.create('Generated two-layer FileGDB benchmark');
async function* multipart() {
  for (const file of await readdir(join(root, 'source.gdb'))) {
    const path = join(root, 'source.gdb', file);
    if (!(await stat(path)).isFile()) continue;
    yield Buffer.from(`--gis-benchmark\r\nContent-Disposition: form-data; name="files"; filename="source.gdb/${file}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
    yield* createReadStream(path); yield Buffer.from('\r\n');
  }
  yield Buffer.from('--gis-benchmark--\r\n');
}
const request = Readable.from(multipart());
request.headers = { 'content-type': 'multipart/form-data; boundary=gis-benchmark' };
const start = performance.now();
const imported = await gis.importFiles(project.id, request);
const importSeconds = (performance.now() - start) / 1000;
if (imported.layers.length !== 2 || imported.layers.some((layer) => layer.featureCount !== count)) throw new Error(JSON.stringify(imported));
const layers = [];
for (const metadata of imported.layers) {
  const durations = {};
  const time = async (name, fn) => { const start = performance.now(); const result = await fn(); durations[name] = (performance.now() - start) / 1000; return result; };
  const layer = await time('previewSeconds', () => gis.getLayer(project.id, metadata.id, [150.4, -33.98, 150.5, -33.97]));
  const page = await time('lastPageSeconds', () => gis.attributes(project.id, metadata.id, { offset: count - 100 }));
  const search = await time('searchSeconds', () => gis.attributes(project.id, metadata.id, { search: `Generated record ${count - 1}` }));
  const record = await gis.feature(project.id, metadata.id, count - 1);
  record.feature.properties.name = 'Persisted last record';
  await time('editSeconds', () => gis.patchLayer(project.id, metadata.id, { ...metadata, edits: [{ ordinal: count - 1, feature: record.feature }] }));
  const exported = await time('exportSeconds', () => gis.exportLayer(project.id, metadata.id));
  let exportedCount = 0, last;
  for await (const feature of collectionFeatures(exported.path)) { exportedCount++; last = feature; }
  if (exportedCount !== count || last.properties.name !== 'Persisted last record') throw new Error('Export lost records or edits.');
  layers.push({ name: metadata.name, records: count, previewRecords: layer.collection.features.length, attributeRows: page.items.length, searchMatches: search.total,
    exportMiB: (await stat(exported.path)).size / 1024 ** 2, indexMiB: (await stat(join(dataDirectory, 'gis-projects', project.id, 'Working', `${metadata.id}.sqlite`))).size / 1024 ** 2, ...durations });
}
const report = { node: process.version, platform: `${process.platform}/${process.arch}`, countPerLayer: count, importSeconds,
  generation: JSON.parse(generated.stdout.trim().split('\n').at(-1)), mainPeakRssMiB: process.resourceUsage().maxRSS / 1024,
  maximumConverterRssMiB: Math.max(...conversionRuns.map((r) => r.peakRssMiB || 0)), layers, conversionRuns };
await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
