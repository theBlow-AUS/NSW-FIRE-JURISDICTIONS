import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import Busboy from 'busboy';
import { buildIndex, openIndex, putFeature, describeIndex, queryAttributes, queryPreview } from './gis-index.mjs';
import { collectionFeatures, writeCollection } from './gis-stream.mjs';

const execute = promisify(execFile);
const idPattern = /^[a-f0-9-]{36}$/;
export class GisError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const assertId = (id) => { if (!idPattern.test(id)) throw new GisError('Invalid project or layer identifier.'); return id; };
const title = (name) => {
  if (typeof name !== 'string' || !name.trim() || name.length > 180) throw new GisError('A name of 1–180 characters is required.');
  return name.trim();
};
export async function atomicJson(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, filename);
}

export function validateCollection(value) {
  if (!value || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) throw new GisError('A GeoJSON FeatureCollection is required.');
  if (value.crs) throw new GisError('Working-copy coordinates must be WGS84 longitude/latitude; remove no CRS declarations without transforming the source.');
  function position(p) {
    if (!Array.isArray(p) || p.length < 2 || p.length > 4 || !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) {
      throw new GisError('Coordinates must be finite WGS84 [longitude, latitude] positions.');
    }
  }
  function line(coords, ring = false) {
    if (!Array.isArray(coords) || coords.length < (ring ? 4 : 2)) throw new GisError('A line needs two positions; a polygon ring needs four including its closing position.');
    coords.forEach(position);
    if (ring && JSON.stringify(coords[0]) !== JSON.stringify(coords.at(-1))) throw new GisError('Polygon rings must be closed.');
  }
  function geometry(g, depth = 0) {
    if (g === null) return;
    if (!g || depth > 12) throw new GisError('Invalid or excessively nested geometry.');
    const coords = g.coordinates;
    switch (g.type) {
      case 'Point': position(coords); break;
      case 'MultiPoint': if (!Array.isArray(coords)) throw new GisError('Invalid MultiPoint.'); coords.forEach(position); break;
      case 'LineString': line(coords); break;
      case 'MultiLineString': if (!Array.isArray(coords)) throw new GisError('Invalid MultiLineString.'); coords.forEach((part) => line(part)); break;
      case 'Polygon': if (!Array.isArray(coords)) throw new GisError('Invalid Polygon.'); coords.forEach((part) => line(part, true)); break;
      case 'MultiPolygon': if (!Array.isArray(coords)) throw new GisError('Invalid MultiPolygon.'); coords.forEach((polygon) => {
        if (!Array.isArray(polygon)) throw new GisError('Invalid polygon.'); polygon.forEach((ring) => line(ring, true));
      }); break;
      case 'GeometryCollection':
        if (!Array.isArray(g.geometries)) throw new GisError('Invalid GeometryCollection.');
        g.geometries.forEach((part) => geometry(part, depth + 1)); break;
      default: throw new GisError('Unsupported GeoJSON geometry type.');
    }
  }
  for (const feature of value.features) {
    if (!feature || feature.type !== 'Feature' || (feature.properties !== null && (typeof feature.properties !== 'object' || Array.isArray(feature.properties)))) {
      throw new GisError('Every feature needs a properties object (or null).');
    }
    if (feature.id != null && !['string', 'number'].includes(typeof feature.id)) throw new GisError('Feature identifiers must be strings or numbers.');
    geometry(feature.geometry);
  }
  return value;
}

function safeUploadPath(name) {
  if (typeof name !== 'string' || name.length > 1024 || /[\\:\0<>|?*"]/.test(name) || name.startsWith('/')) throw new GisError('Invalid upload filename.');
  const parts = name.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new GisError('Unsafe or unsupported upload path.');
  }
  return parts;
}

async function receiveFiles(request, directory, maximum) {
  if (!/^multipart\/form-data;/i.test(request.headers['content-type'] || '')) throw new GisError('Use a multipart file or directory upload.');
  const files = [], tasks = [];
  let total = 0, failure = null;
  const parser = Busboy({ headers: request.headers, preservePath: true, limits: { files: 30000, parts: 30010, fileSize: maximum, fields: 2 } });
  await new Promise((done, reject) => {
    parser.on('file', (_field, stream, info) => {
      let path;
      try {
        const parts = safeUploadPath(info.filename);
        path = join(directory, ...parts);
        if (files.some((file) => file.path === parts.join('/'))) throw new GisError('Duplicate upload paths are not allowed.');
        const record = { path: parts.join('/'), bytes: 0, sha256: null };
        files.push(record);
        const hash = createHash('sha256');
        const meter = new Transform({
          transform(bytes, _encoding, done) {
            total += bytes.length; record.bytes += bytes.length; hash.update(bytes);
            done(total > maximum ? new GisError('The import exceeds the configured maximum upload size.', 413) : null, bytes);
          },
        });
        stream.on('limit', () => stream.destroy(new GisError('An uploaded file exceeds the size limit.', 413)));
        tasks.push((async () => {
          await mkdir(dirname(path), { recursive: true });
          await pipeline(stream, meter, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
          record.sha256 = hash.digest('hex');
        })().catch((error) => { failure = error; parser.destroy(error); }));
      } catch (error) { failure = error; stream.resume(); parser.destroy(error); }
    });
    parser.on('filesLimit', () => parser.destroy(new GisError('The import contains too many files.', 413)));
    parser.on('partsLimit', () => parser.destroy(new GisError('The import contains too many parts.', 413)));
    parser.once('error', reject);
    parser.once('close', done);
    request.once('aborted', () => parser.destroy(new GisError('The upload was interrupted.')));
    request.pipe(parser);
  });
  await Promise.all(tasks);
  if (failure) throw failure;
  if (!files.length) throw new GisError('No files were uploaded.');
  return files;
}

export function createGisStore({ dataDirectory, maxImportBytes = 8 * 1024 ** 3, converter } = {}) {
  const directory = join(dataDirectory, 'gis-projects');
  const projects = new Map();
  let busy = false;
  const projectPath = (id) => join(directory, assertId(id));
  const project = (id) => {
    const value = projects.get(assertId(id));
    if (!value) throw new GisError('Project not found.', 404);
    return value;
  };
  const layer = (projectId, layerId) => {
    const value = project(projectId).layers.find((entry) => entry.id === assertId(layerId));
    if (!value) throw new GisError('Layer not found.', 404);
    return value;
  };
  const persist = async (value) => {
    value.updatedAt = new Date().toISOString();
    await atomicJson(join(projectPath(value.id), 'project.json'), value);
  };
  async function exclusive(operation) {
    if (busy) throw new GisError('Another local GIS operation is running. Try again when it finishes.', 409);
    busy = true;
    try { return await operation(); } finally { busy = false; }
  }
  const convert = converter || (async (source, output, strict = false) => {
    try {
      await execute(process.execPath, ['--max-old-space-size=4096', join(dirname(fileURLToPath(import.meta.url)), 'gis-worker.mjs'), source, output, ...(strict ? ['--validate'] : [])], {
        timeout: 15 * 60 * 1000, maxBuffer: 1024 * 1024, windowsHide: true,
      });
    } catch (error) { throw new GisError(`Local GDAL conversion failed: ${(error.stderr || error.message).slice(0, 1500)}`); }
    return JSON.parse(await readFile(join(output, 'result.json'), 'utf8'));
  });
  const indexing = new Map();
  const indexPath = (projectId, layerId) => join(projectPath(projectId), 'Working', `${assertId(layerId)}.sqlite`);
  async function ensureIndex(projectId, layerId) {
    const metadata = layer(projectId, layerId), filename = indexPath(projectId, layerId);
    try { await stat(filename); return filename; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (metadata.revision > 0) throw new GisError('The edited working index is missing. Restore the complete project backup; the original source has not been changed.', 409);
    if (!indexing.has(filename)) indexing.set(filename, (async () => {
      const temporary = `${filename}.${randomUUID()}.tmp`;
      try {
        await buildIndex(join(projectPath(projectId), 'Working', basename(metadata.workingFile || `${layerId}.geojson`)), temporary, validateCollection);
        await rename(temporary, filename);
      } finally { await rm(temporary, { force: true }); indexing.delete(filename); }
    })());
    await indexing.get(filename); return filename;
  }
  async function withIndex(projectId, layerId, operation) {
    const db = openIndex(await ensureIndex(projectId, layerId));
    try { return operation(db); }
    catch (error) { if (error instanceof RangeError) throw new GisError(error.message); throw error; }
    finally { db.close(); }
  }
  function indexedMetadata(db, metadata) {
    const saved = db.prepare("SELECT value FROM state WHERE key='metadata'").get();
    return { ...(saved ? JSON.parse(saved.value) : metadata), revision: Number(db.prepare("SELECT value FROM state WHERE key='revision'").get().value) };
  }
  return {
    async initialise() {
      await mkdir(directory, { recursive: true });
      await mkdir(join(dataDirectory, 'gis-trash'), { recursive: true });
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isDirectory() || !idPattern.test(entry.name)) continue;
        const value = JSON.parse(await readFile(join(directory, entry.name, 'project.json'), 'utf8'));
        if (value.id !== entry.name || !Array.isArray(value.layers)) throw new Error(`Invalid saved GIS project ${entry.name}; the project has not been overwritten.`);
        projects.set(value.id, value);
        // A committed SQLite edit remains authoritative if project.json could
        // not be refreshed (e.g. power failure between the two writes).
        for (let i = 0; i < value.layers.length; i++) {
          try {
            await stat(indexPath(value.id, value.layers[i].id));
            value.layers[i] = await withIndex(value.id, value.layers[i].id, (db) => indexedMetadata(db, value.layers[i]));
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
      }
    },
    list() { return structuredClone([...projects.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); },
    create(name) { return exclusive(async () => {
      const id = randomUUID(), now = new Date().toISOString();
      const value = { id, name: title(name), createdAt: now, updatedAt: now, layers: [], imports: [] };
      await mkdir(join(projectPath(id), 'Sources'), { recursive: true });
      await mkdir(join(projectPath(id), 'Working'), { recursive: true });
      await mkdir(join(projectPath(id), 'Exports'), { recursive: true });
      await persist(value); projects.set(id, value);
      return structuredClone(value);
    }); },
    rename(id, name) { return exclusive(async () => {
      const next = { ...project(id), name: title(name) }; await persist(next); projects.set(id, next); return structuredClone(next);
    }); },
    remove(id) { return exclusive(async () => {
      project(id);
      await rename(projectPath(id), join(dataDirectory, 'gis-trash', `${id}-${Date.now()}`)); projects.delete(id);
      return { removed: true, archived: true };
    }); },
    async getLayer(projectId, layerId, bbox) {
      return withIndex(projectId, layerId, (db) => {
        let metadata = indexedMetadata(db, layer(projectId, layerId));
        if (metadata.bounds === undefined) metadata = { ...metadata, ...describeIndex(db) };
        const b = bbox || metadata.bounds;
        const extent = b ? [b[0] - 0.0001, b[1] - 0.0001, b[2] + 0.0001, b[3] + 0.0001] : [-180, -90, 180, 90];
        return { ...metadata, ...queryPreview(db, bbox || extent) };
      });
    },
    async attributes(projectId, layerId, options) {
      return withIndex(projectId, layerId, (db) => queryAttributes(db, options));
    },
    async feature(projectId, layerId, ordinal) {
      if (!Number.isSafeInteger(ordinal) || ordinal < 0) throw new GisError('Invalid feature ordinal.');
      return withIndex(projectId, layerId, (db) => {
        const row = db.prepare('SELECT json FROM features WHERE ordinal=?').get(ordinal);
        if (!row) throw new GisError('Feature not found.', 404);
        return { feature: JSON.parse(row.json), ordinal, revision: Number(db.prepare("SELECT value FROM state WHERE key='revision'").get().value) };
      });
    },
    patchLayer(projectId, layerId, change) { return exclusive(async () => {
      const filename = await ensureIndex(projectId, layerId), db = openIndex(filename);
      let metadata;
      try {
        db.exec('BEGIN IMMEDIATE;');
        const previous = indexedMetadata(db, layer(projectId, layerId));
        if (change.revision !== previous.revision) throw new GisError('The layer changed. Reload before saving; your draft has not been applied.', 409);
        if (!Array.isArray(change.edits) || change.edits.length > 100) throw new GisError('At most 100 feature edits per save are allowed.');
        if (typeof change.visible !== 'boolean' || !/^#[0-9a-f]{6}$/i.test(change.style?.color || '') ||
          !Number.isFinite(change.style?.fillOpacity) || change.style.fillOpacity < 0 || change.style.fillOpacity > 1) throw new GisError('Invalid layer style.');
        const seen = new Set();
        for (const edit of change.edits) {
          if (!Number.isSafeInteger(edit.ordinal) || edit.ordinal < 0 || seen.has(edit.ordinal) || !db.prepare('SELECT 1 FROM features WHERE ordinal=?').get(edit.ordinal)) throw new GisError('Invalid or duplicate feature ordinal.');
          seen.add(edit.ordinal);
          validateCollection({ type: 'FeatureCollection', features: [edit.feature] });
          putFeature(db, edit.ordinal, edit.feature);
        }
        metadata = { ...previous, ...(change.edits.length ? describeIndex(db) : {}), name: title(change.name), visible: change.visible, style: change.style,
          editedAt: new Date().toISOString(), revision: previous.revision + 1 };
        db.prepare("UPDATE state SET value=? WHERE key='revision'").run(String(metadata.revision));
        db.prepare("INSERT OR REPLACE INTO state VALUES ('metadata', ?)").run(JSON.stringify(metadata));
        db.exec('COMMIT;');
      } catch (error) { db.exec('ROLLBACK;'); throw error; } finally { db.close(); }
      const next = { ...project(projectId), layers: project(projectId).layers.map((entry) => entry.id === layerId ? metadata : entry) };
      projects.set(projectId, next);
      await persist(next);
      return metadata;
    }); },
    saveLayer() {
      throw new GisError('Whole-layer updates are disabled. Use revision-checked sparse feature edits.', 410);
    },
    removeLayer(projectId, layerId) { return exclusive(async () => {
      const previous = layer(projectId, layerId);
      const value = { ...project(projectId), layers: project(projectId).layers.filter((entry) => entry.id !== layerId) };
      await persist(value); projects.set(projectId, value);
      await rm(join(projectPath(projectId), 'Working', basename(previous.workingFile || `${layerId}.geojson`)), { force: true });
      await rm(indexPath(projectId, layerId), { force: true });
      return { removed: true, originalSourceRetained: true };
    }); },
    importFiles(projectId, request) { return exclusive(async () => {
      const value = project(projectId), importId = randomUUID();
      const sources = join(projectPath(projectId), 'Sources', importId);
      await mkdir(sources, { recursive: true });
      const files = await receiveFiles(request, sources, maxImportBytes);
      const roots = new Set(), warnings = [], imported = [];
      for (const file of files) {
        const parts = file.path.split('/');
        const gdb = parts.findIndex((part) => part.toLowerCase().endsWith('.gdb'));
        if (gdb >= 0) roots.add(parts.slice(0, gdb + 1).join('/'));
        else if (/\.(?:kml|kmz|geojson|json)$/i.test(file.path) || /\.gdb\.zip$/i.test(file.path)) roots.add(file.path);
        else if (/\.lyr$/i.test(file.path)) warnings.push(`${file.path}: ArcMap .lyr is a layer reference, not feature data. It is retained unchanged. Upload its linked geodatabase/KML/GeoJSON separately; exact Esri symbols are not reproduced.`);
        else warnings.push(`${file.path}: retained as a source companion file; not independently imported.`);
      }
      await atomicJson(join(projectPath(projectId), 'Sources', `${importId}.manifest.json`), { importedAt: new Date().toISOString(), files });
      for (const root of roots) {
        const output = join(projectPath(projectId), 'Working', `.convert-${randomUUID()}`);
        try {
          if (/\.kml$/i.test(root)) {
            const content = await readFile(join(sources, root), 'utf8');
            if (/<!\s*(?:DOCTYPE|ENTITY)|<NetworkLink\b/i.test(content)) throw new GisError('External entities and KML network links are not imported.');
          }
          let direct = /\.(?:geojson|json)$/i.test(root), prebuilt = null;
          if (direct) await mkdir(output, { recursive: true });
          if (direct) {
            const id = randomUUID();
            try {
              prebuilt = { id, description: await buildIndex(join(sources, root), indexPath(projectId, id), validateCollection) };
            } catch (error) {
              await rm(indexPath(projectId, id), { force: true });
              if (error.code !== 'GEOJSON_CRS') throw error;
              direct = false; // Preserve legacy projected-GeoJSON support via GDAL.
            }
          }
          const result = direct ? { warnings: [], layers: [{ file: root, name: basename(root), sourceFormat: 'GeoJSON', crs: 'EPSG:4326' }] } : await convert(join(sources, root), output);
          warnings.push(...result.warnings);
          for (const converted of result.layers) {
            const id = prebuilt?.id || randomUUID();
            const convertedFile = direct ? join(sources, root) : join(output, basename(converted.file));
            const description = prebuilt?.description || await buildIndex(convertedFile, indexPath(projectId, id), validateCollection);
            const metadata = {
              id, name: converted.name, sourceName: root, sourceFormat: converted.sourceFormat,
              crs: converted.crs || (/kml|geojson/i.test(converted.sourceFormat) ? 'WGS84 (EPSG:4326)' : null),
              sourceCrsWkt: converted.sourceCrsWkt || null,
              ...description, revision: 0, visible: true, style: { color: '#a8442d', fillOpacity: 0.25 },
              sourceUpdatedAt: null, importedAt: new Date().toISOString(),
              warning: 'Working coordinates are WGS84. Source styling, attachments, relationships and geodatabase rules are not GeoJSON features.',
              importId, workingFile: `${id}.geojson`, workingCrs: 'EPSG:4326',
              transformations: direct ? ['Streaming WGS84 GeoJSON validation', 'Local disk-backed working index'] : ['GDAL/OGR vector conversion', 'Reproject to EPSG:4326', 'RFC 7946 GeoJSON'],
            };
            // Keep a streaming WGS84 working snapshot for recovery/migration.
            await pipeline((await import('node:fs')).createReadStream(convertedFile), createWriteStream(join(projectPath(projectId), 'Working', `${id}.geojson`), { flags: 'wx', mode: 0o600 }));
            imported.push(metadata);
          }
        } catch (error) { warnings.push(`${root}: ${error.message}`); }
        finally { await rm(output, { recursive: true, force: true }); }
      }
      const next = { ...value, layers: [...value.layers, ...imported], imports: [...value.imports, { id: importId, files, warnings }] };
      await persist(next); projects.set(projectId, next);
      return { layers: imported, warnings };
    }); },
    exportLayer(projectId, layerId, decorate) { return exclusive(async () => {
      const metadata = layer(projectId, layerId);
      const temporary = join(projectPath(projectId), 'Exports', `.validate-${randomUUID()}`);
      await mkdir(temporary, { recursive: true });
      const filename = `${layerId}-${randomUUID()}.geojson`;
      const path = join(projectPath(projectId), 'Exports', filename);
      const db = openIndex(await ensureIndex(projectId, layerId));
      let enriched = decorate ? decorate({ type: 'FeatureCollection', features: [] }).provenance : null, exportedCount = 0;
      async function* validatedBatches() {
        let batch = [], bytes = 0, batchNumber = 0;
        async function* flush() {
          const input = join(temporary, `batch-${batchNumber++}.geojson`), output = `${input}.validated`;
          await writeCollection(input, batch);
          const result = await convert(input, output, true);
          if (result.layers.length !== 1) throw new GisError('Validation must return exactly one layer.');
          let count = 0;
          for await (const feature of collectionFeatures(join(output, basename(result.layers[0].file)))) {
            validateCollection({ type: 'FeatureCollection', features: [feature] });
            count++; exportedCount++;
            if (decorate) {
              const decorated = decorate({ type: 'FeatureCollection', features: [feature] });
              if (!enriched) enriched = { ...decorated.provenance, counts: { matched: 0, unmatched: 0, ambiguous: 0 } };
              for (const k of Object.keys(enriched.counts)) enriched.counts[k] += decorated.provenance.counts[k];
              yield decorated.data.features[0];
            } else yield feature;
          }
          if (count !== batch.length) throw new GisError('Validation changed the feature count; no export was published.');
          await rm(input, { force: true }); await rm(output, { recursive: true, force: true });
          batch = []; bytes = 0;
        }
        for (const row of db.prepare('SELECT json FROM features ORDER BY ordinal').iterate()) {
          if (batch.length && (bytes + Buffer.byteLength(row.json) > 8 * 1024 ** 2 || batch.length >= 10000)) yield* flush();
          const feature = JSON.parse(row.json);
          validateCollection({ type: 'FeatureCollection', features: [feature] });
          batch.push(feature); bytes += Buffer.byteLength(row.json);
        }
        if (batch.length) yield* flush();
      }
      try {
        await writeCollection(path, validatedBatches());
        if (exportedCount !== metadata.featureCount) throw new GisError('Export count does not match the working layer.');
      } catch (error) { await rm(path, { force: true }); throw error; }
      finally { db.close(); await rm(temporary, { recursive: true, force: true }); }
      const manifest = {
        exportedAt: new Date().toISOString(), project: { id: projectId, name: project(projectId).name },
        layer: metadata, coordinateSystem: 'WGS84 longitude/latitude (RFC 7946)',
        validation: 'GeoJSON structure, finite WGS84 coordinates, closed rings, GDAL/GEOS ST_IsValid, RFC 7946 export normalization. No automatic topology repair.',
        sourceManifest: `Sources/${metadata.importId}.manifest.json`,
        regionalEnrichment: enriched,
      };
      await atomicJson(join(projectPath(projectId), 'Exports', `${filename}.manifest.json`), manifest);
      return { path, manifest, name: `${metadata.name.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 100) || 'layer'}.geojson` };
    }); },
  };
}
