import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import Busboy from 'busboy';

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

function describe(collection) {
  const fields = new Set();
  const geometryTypes = new Set();
  for (const feature of collection.features) {
    Object.keys(feature.properties || {}).forEach((name) => fields.add(name));
    geometryTypes.add(feature.geometry?.type || 'Unmapped');
  }
  return { featureCount: collection.features.length, fields: [...fields], geometryType: [...geometryTypes].join(', ') || 'Empty' };
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
  return {
    async initialise() {
      await mkdir(directory, { recursive: true });
      await mkdir(join(dataDirectory, 'gis-trash'), { recursive: true });
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isDirectory() || !idPattern.test(entry.name)) continue;
        const value = JSON.parse(await readFile(join(directory, entry.name, 'project.json'), 'utf8'));
        if (value.id !== entry.name || !Array.isArray(value.layers)) throw new Error(`Invalid saved GIS project ${entry.name}; the project has not been overwritten.`);
        projects.set(value.id, value);
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
    async getLayer(projectId, layerId) {
      const metadata = layer(projectId, layerId);
      const collection = JSON.parse(await readFile(join(projectPath(projectId), 'Working', basename(metadata.workingFile || `${layerId}.geojson`)), 'utf8'));
      return { ...structuredClone(metadata), collection };
    },
    saveLayer(projectId, layerId, change) { return exclusive(async () => {
      const previous = layer(projectId, layerId);
      const collection = validateCollection(change.collection);
      if (typeof change.visible !== 'boolean' || !/^#[0-9a-f]{6}$/i.test(change.style?.color || '') ||
          !Number.isFinite(change.style?.fillOpacity) || change.style.fillOpacity < 0 || change.style.fillOpacity > 1) throw new GisError('Invalid layer visibility or style.');
      const metadata = { ...previous, ...describe(collection), name: title(change.name), visible: change.visible, style: change.style, editedAt: new Date().toISOString(), workingFile: `${layerId}-${randomUUID()}.geojson` };
      await atomicJson(join(projectPath(projectId), 'Working', metadata.workingFile), collection);
      const next = { ...project(projectId), layers: project(projectId).layers.map((entry) => entry.id === layerId ? metadata : entry) };
      await persist(next); projects.set(projectId, next); return metadata;
    }); },
    removeLayer(projectId, layerId) { return exclusive(async () => {
      const previous = layer(projectId, layerId);
      const value = { ...project(projectId), layers: project(projectId).layers.filter((entry) => entry.id !== layerId) };
      await persist(value); projects.set(projectId, value);
      await rm(join(projectPath(projectId), 'Working', basename(previous.workingFile || `${layerId}.geojson`)), { force: true });
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
          if (/\.(?:geojson|json)$/i.test(root)) {
            const content = JSON.parse(await readFile(join(sources, root), 'utf8'));
            if (content.type !== 'FeatureCollection' && content.type !== 'Feature') throw new GisError('Only GeoJSON feature data is accepted for JSON imports.');
          }
          const result = await convert(join(sources, root), output);
          warnings.push(...result.warnings);
          for (const converted of result.layers) {
            const collection = validateCollection(JSON.parse(await readFile(join(output, basename(converted.file)), 'utf8')));
            const id = randomUUID();
            const metadata = {
              id, name: converted.name, sourceName: root, sourceFormat: converted.sourceFormat,
              crs: converted.crs || (/kml|geojson/i.test(converted.sourceFormat) ? 'WGS84 (EPSG:4326)' : null),
              sourceCrsWkt: converted.sourceCrsWkt || null,
              ...describe(collection), visible: true, style: { color: '#a8442d', fillOpacity: 0.25 },
              sourceUpdatedAt: null, importedAt: new Date().toISOString(),
              warning: 'Working coordinates are WGS84. Source styling, attachments, relationships and geodatabase rules are not GeoJSON features.',
              importId, workingFile: `${id}.geojson`, workingCrs: 'EPSG:4326', transformations: ['GDAL/OGR vector conversion', 'Reproject to EPSG:4326', 'RFC 7946 GeoJSON'],
            };
            await atomicJson(join(projectPath(projectId), 'Working', `${id}.geojson`), collection);
            imported.push(metadata);
          }
        } catch (error) { warnings.push(`${root}: ${error.message}`); }
        finally { await rm(output, { recursive: true, force: true }); }
      }
      const next = { ...value, layers: [...value.layers, ...imported], imports: [...value.imports, { id: importId, files, warnings }] };
      await persist(next); projects.set(projectId, next);
      return { layers: imported, warnings };
    }); },
    async exportLayer(projectId, layerId, decorate) {
      const metadata = layer(projectId, layerId);
      validateCollection((await this.getLayer(projectId, layerId)).collection);
      const temporary = join(projectPath(projectId), 'Exports', `.validate-${randomUUID()}`);
      let data;
      try {
        const converted = await convert(join(projectPath(projectId), 'Working', basename(metadata.workingFile || `${layerId}.geojson`)), temporary, true);
        data = JSON.parse(await readFile(join(temporary, basename(converted.layers[0].file)), 'utf8'));
        validateCollection(data);
      } finally { await rm(temporary, { recursive: true, force: true }); }
      const enriched = decorate ? decorate(data) : null;
      if (enriched) data = enriched.data;
      const filename = `${layerId}-${randomUUID()}.geojson`;
      const manifest = {
        exportedAt: new Date().toISOString(), project: { id: projectId, name: project(projectId).name },
        layer: metadata, coordinateSystem: 'WGS84 longitude/latitude (RFC 7946)',
        validation: 'GeoJSON structure, finite WGS84 coordinates, closed rings, GDAL/GEOS ST_IsValid, RFC 7946 export normalization. No automatic topology repair.',
        sourceManifest: `Sources/${metadata.importId}.manifest.json`,
        regionalEnrichment: enriched?.provenance || null,
      };
      await atomicJson(join(projectPath(projectId), 'Exports', filename), data);
      await atomicJson(join(projectPath(projectId), 'Exports', `${filename}.manifest.json`), manifest);
      return { data, manifest, name: `${metadata.name.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 100) || 'layer'}.geojson` };
    },
  };
}
