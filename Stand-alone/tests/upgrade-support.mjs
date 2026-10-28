import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Include every regular file, including nested FileGDB files and SQLite sidecars.
// Do not follow links out of the test workspace.
export async function inventory(root) {
  const result = {};
  async function visit(path) {
    const info = await lstat(path);
    assert.ok(!info.isSymbolicLink(), `Refusing linked test data: ${path}`);
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await visit(join(path, name));
    } else {
      assert.ok(info.isFile(), `Not a regular file: ${path}`);
      result[relative(root, path).split(sep).join('/')] = sha256(await readFile(path));
    }
  }
  await visit(root);
  return result;
}

export async function assertRetained(root, expected) {
  for (const [name, hash] of Object.entries(expected)) {
    const path = resolve(root, name);
    assert.ok(path.startsWith(resolve(root) + sep), 'Unsafe inventory path');
    assert.equal(sha256(await readFile(path)), hash, `Changed or missing retained file: ${name}`);
  }
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}

export async function seedWorkspace(data) {
  const id = randomUUID(), layer = randomUUID(), imported = randomUUID();
  const date = '2026-10-01T00:00:00.000Z';
  const collection = { type: 'FeatureCollection', features: [
    { type: 'Feature', id: 1, properties: { name: 'Upgrade pilot — edited', council: 'SYDNEY' },
      geometry: { type: 'Point', coordinates: [151.2093, -33.8688] } },
  ] };
  const project = { id, name: 'Installer preservation pilot', createdAt: date, updatedAt: date,
    imports: [], layers: [{ id: layer, name: 'Pilot points', importId: imported,
      workingFile: `${layer}.geojson`, fields: ['name', 'council'], featureCount: 1,
      geometryTypes: ['Point'], sourceFormat: 'GeoJSON', crs: 'EPSG:4326', revision: 0 }] };
  const root = join(data, 'gis-projects', id);
  await writeJson(join(root, 'project.json'), project);
  await writeJson(join(root, 'Sources', imported, 'pilot.geojson'), {
    ...collection, features: [{ ...collection.features[0], properties: { name: 'Original source', council: 'SYDNEY' } }],
  });
  await writeJson(join(root, 'Sources', `${imported}.manifest.json`), { importedAt: date, files: ['pilot.geojson'] });
  await writeJson(join(root, 'Working', `${layer}.geojson`), collection);
  await writeJson(join(root, 'Exports', 'pilot.geojson'), collection);
  await writeJson(join(root, 'Exports', 'pilot.geojson.manifest.json'), { exportedAt: date, projectId: id });
  // Real parseable cached feed, never dependent on a live external request.
  await writeJson(join(data, 'live-feeds', 'incidents-json.json'), {
    raw: JSON.stringify(collection), lastAttemptAt: date, lastSuccessAt: date, sourceUpdatedAt: date,
    error: null, etag: '"upgrade-pilot"',
  });
  return { id, layer };
}

export async function assertWorkspace(base, fixture) {
  const json = async (path) => {
    const response = await fetch(base + path, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, path);
    return response.json();
  };
  const workspace = await json('/api/gis/state');
  assert.ok(workspace.projects.some((p) => p.id === fixture.id), 'Saved GIS project not loaded');
  assert.ok(workspace.feeds.incidents.features.some((f) => f.properties.name === 'Upgrade pilot — edited'), 'Cached feed not loaded');
  // This endpoint is shared by the original GIS release and the paged/indexed
  // runtime. Do not require a newer feature-detail route from older packages.
  const layer = await json(`/api/gis/projects/${fixture.id}/layers/${fixture.layer}`);
  assert.equal(layer.collection.features[0].properties.name, 'Upgrade pilot — edited', 'Working feature not readable');
  const rfs = await json('/api/rfs/snapshot');
  assert.ok(rfs.snapshot.permitRows.length >= 100, 'Permit cache not readable');
}
