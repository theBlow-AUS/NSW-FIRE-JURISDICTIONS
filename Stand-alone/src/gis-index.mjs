import { DatabaseSync } from 'node:sqlite';
import { collectionFeatures, MAX_FEATURE_BYTES } from './gis-stream.mjs';

export function boundsOf(geometry) {
  let bounds = null;
  const visit = (value) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number') {
      if (!bounds) bounds = [value[0], value[1], value[0], value[1]];
      bounds = [Math.min(bounds[0], value[0]), Math.min(bounds[1], value[1]), Math.max(bounds[2], value[0]), Math.max(bounds[3], value[1])];
    } else value.forEach(visit);
  };
  const walk = (g) => { if (!g) return; if (g.type === 'GeometryCollection') g.geometries.forEach(walk); else visit(g.coordinates); };
  walk(geometry); return bounds;
}

export function openIndex(filename) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA cache_size=-8192; PRAGMA temp_store=FILE; PRAGMA busy_timeout=5000;');
  return db;
}

export function putFeature(db, ordinal, feature) {
  const json = JSON.stringify(feature);
  if (Buffer.byteLength(json) > MAX_FEATURE_BYTES) throw new Error('Feature exceeds the 8 MiB working limit.');
  const props = JSON.stringify(feature.properties);
  db.prepare('INSERT OR REPLACE INTO features VALUES (?, ?, ?, ?, ?)').run(ordinal, json, props, feature.geometry?.type || 'Unmapped', String(feature.id ?? ''));
  db.prepare('DELETE FROM spatial WHERE ordinal=?').run(ordinal);
  const b = boundsOf(feature.geometry);
  if (b) db.prepare('INSERT INTO spatial VALUES (?, ?, ?, ?, ?)').run(ordinal, b[0], b[2], b[1], b[3]);
}

export async function buildIndex(source, destination, validate) {
  const db = openIndex(destination);
  try {
    db.exec(`CREATE TABLE features (ordinal INTEGER PRIMARY KEY, json TEXT NOT NULL, props TEXT NOT NULL, geometryType TEXT NOT NULL, featureId TEXT NOT NULL);
      CREATE VIRTUAL TABLE spatial USING rtree(ordinal, minX, maxX, minY, maxY);
      CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO state VALUES ('revision', '0'); BEGIN;`);
    let count = 0, validationError = null;
    for await (const feature of collectionFeatures(source)) {
      // Finish scanning the envelope even after a coordinate error: a legacy
      // CRS declaration may follow features and must trigger reprojection.
      if (validationError) continue;
      try { validate({ type: 'FeatureCollection', features: [feature] }); }
      catch (error) { validationError = error; continue; }
      putFeature(db, count++, feature);
      if (count % 1000 === 0) db.exec('COMMIT; BEGIN;');
    }
    db.exec('COMMIT;');
    if (validationError) throw validationError;
    return describeIndex(db);
  } finally { db.close(); }
}

export function describeIndex(db) {
  const fields = [];
  let fieldBytes = 0;
  for (const row of db.prepare(`SELECT DISTINCT j.key FROM features, json_each(CASE WHEN props='null' THEN '{}' ELSE props END) j LIMIT 2001`).iterate()) {
    fieldBytes += Buffer.byteLength(row.key);
    if (fields.length >= 2000 || fieldBytes > 1024 ** 2) throw new Error('Layer exceeds the 2,000-field / 1 MiB field-name metadata limit.');
    fields.push(row.key);
  }
  fields.sort();
  const b = db.prepare('SELECT min(minX) a, min(minY) b, max(maxX) c, max(maxY) d FROM spatial').get();
  return { featureCount: db.prepare('SELECT count(*) n FROM features').get().n, fields,
    geometryType: db.prepare('SELECT DISTINCT geometryType FROM features').all().map((r) => r.geometryType).join(', ') || 'Empty',
    bounds: b.a == null ? null : [b.a, b.b, b.c, b.d] };
}

export function queryAttributes(db, { offset = 0, limit = 100, search = '' } = {}) {
  offset = Number(offset); limit = Number(limit);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200 || typeof search !== 'string' || search.length > 300) throw new RangeError('Invalid attribute page (maximum 200 rows).');
  const q = `%${search.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
  const where = search ? `WHERE lower(props || ' ' || featureId) LIKE ? ESCAPE '\\'` : '';
  const args = search ? [q] : [];
  const total = db.prepare(`SELECT count(*) n FROM features ${where}`).get(...args).n;
  const rows = db.prepare(`SELECT ordinal, props, geometryType, featureId FROM features ${where} ORDER BY ordinal LIMIT ? OFFSET ?`).iterate(...args, limit, offset);
  // Attribute pages have a byte budget as well as a row limit.
  let bytes = 0;
  const items = [];
  for (const r of rows) {
    if (items.length && bytes + Buffer.byteLength(r.props) > 2 * 1024 ** 2) break;
    bytes += Buffer.byteLength(r.props);
    items.push({ ordinal: r.ordinal, geometryType: r.geometryType, feature: { type: 'Feature', id: r.featureId, properties: JSON.parse(r.props), geometry: null } });
  }
  return { items, total, offset, nextOffset: offset + items.length < total ? offset + items.length : null };
}

export function queryPreview(db, bbox) {
  if (!bbox || bbox.length !== 4 || !bbox.every(Number.isFinite) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) throw new RangeError('A valid viewport bbox is required.');
  const rows = db.prepare(`SELECT f.ordinal, f.json FROM spatial s JOIN features f USING(ordinal)
    WHERE s.maxX>=? AND s.minX<=? AND s.maxY>=? AND s.minY<=? ORDER BY s.ordinal LIMIT 1001`).iterate(bbox[0], bbox[2], bbox[1], bbox[3]);
  const features = [], ordinals = [];
  let bytes = 0, truncated = false;
  for (const row of rows) {
    bytes += Buffer.byteLength(row.json);
    if (features.length >= 1000 || bytes > 2 * 1024 ** 2) { truncated = true; continue; }
    features.push(JSON.parse(row.json)); ordinals.push(row.ordinal);
  }
  return { collection: { type: 'FeatureCollection', features }, ordinals, truncated, bbox };
}
