import { createReadStream, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';

// A streaming JSON value scanner, not a regex split: strings, escapes and nested
// geometries may contain every delimiter. Only one feature is retained at once.
export const MAX_FEATURE_BYTES = 8 * 1024 ** 2;
export async function* collectionFeatures(filename) {
  let mode = 'root', key = '', depth = 0, quoted = false, escaped = false;
  let type = '', features = false, afterComma = false;
  let pieces = [], size = 0, start = -1;
  const envelope = {}, keys = new Set();
  for await (const chunk of createReadStream(filename, { encoding: 'utf8', highWaterMark: 64 * 1024 })) {
    const parse = (end) => {
      if (start >= 0) pieces.push(chunk.slice(start, end));
      const text = pieces.join('');
      if (Buffer.byteLength(text) > MAX_FEATURE_BYTES) throw new Error('Feature or metadata value exceeds 8 MiB.');
      const value = JSON.parse(text);
      pieces = []; size = 0; start = -1; return value;
    };
    for (let index = 0; index < chunk.length; index++) {
      const char = chunk[index];
      if (mode === 'done') { if (!/\s/.test(char)) throw new Error('Trailing GeoJSON content.'); continue; }
      if (mode === 'root') {
        if (/\s/.test(char)) continue;
        if (char !== '{') throw new Error('A GeoJSON FeatureCollection object is required.');
        mode = 'key'; continue;
      }
      if (mode === 'key') {
        if (/\s/.test(char)) continue;
        if (char === '}' && !afterComma) { mode = 'done'; continue; }
        if (char !== '"') throw new Error('Invalid GeoJSON member.');
        start = index; size = 1; quoted = true; escaped = false; mode = 'keyString'; continue;
      }
      if (mode === 'colon') {
        if (/\s/.test(char)) continue;
        if (char !== ':') throw new Error('Invalid GeoJSON member separator.');
        mode = key === 'features' ? 'array' : 'valueStart'; continue;
      }
      if (mode === 'array') {
        if (/\s/.test(char)) continue;
        if (char !== '[' || features) throw new Error('Exactly one features array is required.');
        features = true; mode = 'featureStart'; afterComma = false; continue;
      }
      if (mode === 'featureStart' || mode === 'valueStart') {
        if (/\s/.test(char)) continue;
        if (mode === 'featureStart' && char === ']' && !afterComma) { mode = 'memberEnd'; continue; }
        if (mode === 'featureStart' && char !== '{') throw new Error('Every feature must be an object.');
        const feature = mode === 'featureStart';
        depth = 0; quoted = false; escaped = false; mode = feature ? 'featureValue' : 'value';
      }
      if (['keyString', 'featureValue', 'value'].includes(mode)) {
        // Primitive values end before their delimiter, which is processed below.
        const primitiveEnd = mode === 'value' && size && !quoted && depth === 0 && /[\s,}]/.test(char);
        if (!primitiveEnd) {
          if (start < 0) start = index;
          size++;
          if (size > MAX_FEATURE_BYTES) throw new Error('A single feature or metadata value exceeds the 8 MiB working limit.');
          if (quoted) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') quoted = false;
          } else if (char === '"') quoted = true;
          else if (char === '{' || char === '[') depth++;
          else if (char === '}' || char === ']') depth--;
        }
        if (mode === 'keyString') {
          if (!quoted) {
            key = parse(index + 1);
            if (['type', 'features', 'crs', 'id', 'geometry', 'properties'].includes(key)) {
              if (keys.has(key)) throw new Error('Duplicate GeoJSON member.');
              keys.add(key);
            }
            mode = 'colon'; afterComma = false;
          }
          continue;
        }
        const complete = primitiveEnd || (!quoted && depth === 0 && /[}\]"]/.test(char));
        if (!complete) continue;
        const value = parse(index + (primitiveEnd ? 0 : 1));
        if (mode === 'featureValue') {
          yield value; mode = 'featureEnd';
        } else {
          if (key === 'crs' && value != null) {
            const error = new Error('GeoJSON must be transformed to WGS84 before indexing a CRS declaration.');
            error.code = 'GEOJSON_CRS'; throw error;
          }
          if (key === 'type') {
            if (type || !['FeatureCollection', 'Feature'].includes(value)) throw new Error('GeoJSON feature data is required.');
            type = value;
          }
          if (['type', 'id', 'properties', 'geometry'].includes(key)) envelope[key] = value;
          mode = 'memberEnd';
        }
        if (!primitiveEnd) continue;
      }
      if (mode === 'featureEnd' || mode === 'memberEnd') {
        if (/\s/.test(char)) continue;
        if (char === ',') { mode = mode === 'featureEnd' ? 'featureStart' : 'key'; afterComma = true; }
        else if (mode === 'featureEnd' && char === ']') { mode = 'memberEnd'; afterComma = false; }
        else if (mode === 'memberEnd' && char === '}') mode = 'done';
        else throw new Error('Invalid GeoJSON delimiter.');
      }
    }
    if (start >= 0) { pieces.push(chunk.slice(start)); start = -1; }
  }
  if (mode !== 'done' || !type || (type === 'FeatureCollection' && !features) || (type === 'Feature' && features)) throw new Error('Incomplete GeoJSON feature data.');
  if (type === 'Feature') yield envelope;
}

export async function writeCollection(filename, features) {
  const stream = createWriteStream(filename, { flags: 'wx', mode: 0o600 });
  const completion = finished(stream);
  // Attach rejection immediately, including errors before the first drain.
  completion.catch(() => {});
  const write = async (text) => { if (!stream.write(text)) await once(stream, 'drain'); };
  try {
    await write('{"type":"FeatureCollection","features":[');
    let first = true;
    for await (const feature of features) {
      await write(`${first ? '' : ','}${JSON.stringify(feature)}`); first = false;
    }
    stream.end(']}'); await completion;
  } catch (error) { stream.destroy(); await completion.catch(() => {}); throw error; }
}
