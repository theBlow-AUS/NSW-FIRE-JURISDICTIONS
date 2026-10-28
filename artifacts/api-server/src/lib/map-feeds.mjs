import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import xml from 'xml-js';

export const FIRE_WEATHER_GEOMETRY = 'https://services1.arcgis.com/vHnIGBHHqDR6y0CR/arcgis/rest/services/Fire_Districts_-_4_Day_Forecast/FeatureServer/5';
const MAX_BYTES = 4 * 1024 * 1024;
const TTL = 15 * 60 * 1000;
const list = (v) => v == null ? [] : Array.isArray(v) ? v : [v];
const field = (obj, name) => obj?.[Object.keys(obj || {}).find((key) => key.split(':').at(-1).toLowerCase() === name.toLowerCase())];
const text = (v) => typeof v === 'string' ? v : list(v?._text ?? v?._cdata).join('');
const plain = (v) => text(v).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();
const normalized = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// RFS publishes "ACT"; the BOM/Esri district is named "Australian Capital Territory".
const regionName = (s) => normalized(s) === 'AUSTRALIANCAPITALTERRITORY' ? 'ACT' : normalized(s);
const hash = (s) => createHash('sha256').update(s).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function validateFeedUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw fail('Enter a public HTTPS feed URL.');
  let url;
  try { url = new URL(value); } catch { throw fail('Enter a valid feed URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) {
    throw fail('Feeds must use HTTPS on port 443, without credentials or fragments.');
  }
  const hostname = url.hostname.toLowerCase();
  if (isIP(hostname.replace(/^\[|\]$/g, '')) || !hostname.includes('.') ||
      /(?:^|\.)(localhost|local|internal|home|test|invalid|example|arpa)$/.test(hostname)) {
    throw fail('Only public DNS hostnames are accepted; local and IP-address feeds are blocked.');
  }
  return url.href;
}

export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168 || b === 88)) || (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0));
  }
  if (isIP(address) !== 6 || !/^[23][0-9a-f]{3}:/i.test(address)) return false;
  const [first, second] = address.toLowerCase().split(':');
  if (first === '2002' || first === '3ffe' || first === '3fff') return false;
  if (first === '2001' && (Number.parseInt(second || '0', 16) < 0x200 || second === 'db8')) return false;
  return true;
}

export async function fetchPublicFeed(value) {
  const url = new URL(validateFeedUrl(value));
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw fail('Feed host resolves to a private or reserved network.');
  const selected = addresses[0];
  // Pin the validated address to the actual TLS request: a second DNS lookup
  // would allow DNS rebinding. Redirects are deliberately not followed.
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      autoSelectFamily: false, family: selected.family,
      lookup: (_hostname, options, done) => options.all ? done(null, [selected]) : done(null, selected.address, selected.family),
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, application/geo+json, application/json', 'User-Agent': 'NSW-Fire-Coverage-Feed-Reader/1.2' },
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume(); reject(fail(`Feed returned HTTP ${response.statusCode}. Redirects are not followed; use its final HTTPS URL.`, 502)); return;
      }
      let size = 0;
      const parts = [];
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) response.destroy(fail('Feed exceeds the 4 MiB safety limit.', 413));
        else parts.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ raw: Buffer.concat(parts).toString('utf8'), lastModified: response.headers['last-modified'] || null }));
    });
    const timer = setTimeout(() => request.destroy(fail('Feed download timed out.', 504)), 20000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
  });
}

function geometry(item) {
  const coordinatePairs = (value) => {
    const raw = text(value).trim();
    if (!raw) return null;
    const numbers = raw.split(/\s+/).map(Number);
    if (numbers.length % 2 || numbers.some((n) => !Number.isFinite(n))) throw fail('Invalid GeoRSS coordinates.');
    const pairs = [];
    for (let i = 0; i < numbers.length; i += 2) {
      if (Math.abs(numbers[i]) > 90 || Math.abs(numbers[i + 1]) > 180) throw fail('GeoRSS coordinates are outside WGS84 ranges.');
      pairs.push([numbers[i + 1], numbers[i]]);
    }
    return pairs;
  };
  const shapes = [];
  const point = coordinatePairs(field(item, 'point'));
  if (point) {
    if (point.length !== 1) throw fail('Invalid GeoRSS point.');
    shapes.push({ type: 'Point', coordinates: point[0] });
  }
  const lat = text(field(item, 'lat')), lon = text(field(item, 'long') ?? field(item, 'lon'));
  if (!point && lat && lon) {
    const pair = coordinatePairs({ _text: `${lat} ${lon}` });
    shapes.push({ type: 'Point', coordinates: pair[0] });
  }
  const line = coordinatePairs(field(item, 'line'));
  if (line) {
    if (line.length < 2) throw fail('A GeoRSS line needs two positions.');
    shapes.push({ type: 'LineString', coordinates: line });
  }
  for (const value of list(field(item, 'polygon'))) {
    const ring = coordinatePairs(value);
    if (!ring || ring.length < 3) throw fail('Invalid GeoRSS polygon.');
    if (JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1))) ring.push([...ring[0]]);
    shapes.push({ type: 'Polygon', coordinates: [ring] });
  }
  const box = coordinatePairs(field(item, 'box'));
  if (box) {
    if (box.length !== 2) throw fail('Invalid GeoRSS box.');
    const [[x1, y1], [x2, y2]] = box;
    shapes.push({ type: 'Polygon', coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]] });
  }
  return shapes.length > 1 ? { type: 'GeometryCollection', geometries: shapes } : shapes[0] || null;
}

export function parseMapFeed(raw) {
  if (Buffer.byteLength(raw) > MAX_BYTES) throw fail('Feed exceeds the 4 MiB safety limit.', 413);
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(raw)) throw fail('XML external entities and document types are not accepted.');
  let doc;
  try { doc = xml.xml2js(raw, { compact: true, trim: true, ignoreComment: true }); }
  catch { throw fail('The URL did not return valid XML.'); }
  const danger = field(doc, 'FireDangerMap');
  if (danger) {
    const regions = list(field(danger, 'District')).map((item) => ({
      number: text(field(item, 'RegionNumber')), name: text(field(item, 'Name')),
      today: text(field(item, 'DangerLevelToday')), tomorrow: text(field(item, 'DangerLevelTomorrow')),
      banToday: text(field(item, 'FireBanToday')), banTomorrow: text(field(item, 'FireBanTomorrow')),
    }));
    if (regions.length < 10 || regions.some((r) => !r.number || !r.name)) throw fail('The RFS fire-danger document is incomplete.');
    return { regions, sourceUpdatedAt: null, warnings: [] };
  }
  const channel = field(field(doc, 'rss'), 'channel');
  const atom = field(doc, 'feed');
  if (!channel && !atom) throw fail('Expected RSS, Atom or RFS FireDangerMap XML.');
  const items = list(channel ? field(channel, 'item') : field(atom, 'entry'));
  const features = items.slice(0, 10000).map((item) => {
    const linkNode = list(field(item, 'link')).find((v) => !v?._attributes?.rel || v._attributes.rel === 'alternate');
    const link = linkNode?._attributes?.href || text(linkNode);
    const title = plain(field(item, 'title'));
    const date = text(field(item, 'pubDate') ?? field(item, 'updated'));
    const id = text(field(item, 'guid') ?? field(item, 'id')) || hash(`${title}|${link}|${date}`).slice(0, 24);
    return { type: 'Feature', id, geometry: geometry(item), properties: {
      title, link: /^https?:\/\//i.test(link) ? link : null, published: date || null,
      description: plain(field(item, 'description') ?? field(item, 'summary') ?? field(item, 'content')),
    } };
  });
  return { features, sourceUpdatedAt: text(field(channel, 'lastBuildDate') ?? field(channel, 'pubDate') ?? field(atom, 'updated')) || null,
    warnings: items.length > 10000 ? ['Feed preview is limited to the first 10,000 entries.'] : [] };
}

export function createMapFeedService({ dataDirectory, liveFeedsEnabled = true, fetcher = fetchPublicFeed, now = () => Date.now() } = {}) {
  const cache = new Map(), pending = new Map(), attempts = new Map();
  let boundaries;
  async function getBoundaries() {
    if (boundaries && now() - boundaries.time < 86400000) return boundaries.data;
    const params = new URLSearchParams({ where: "STATE_CODE IN ('NSW','ACT') AND Forecast_Period=1", outFields: 'DIST_NO,DIST_NAME,AAC', outSR: '4326', f: 'geojson', maxAllowableOffset: '0.002', geometryPrecision: '4' });
    const response = await fetcher(`${FIRE_WEATHER_GEOMETRY}/query?${params}`);
    const data = JSON.parse(response.raw);
    if (data.type !== 'FeatureCollection' || data.features?.length !== 21 || data.exceededTransferLimit ||
        data.features.some((f) => !['Polygon', 'MultiPolygon'].includes(f.geometry?.type))) throw fail('The fire-weather geometry source is incomplete.', 502);
    boundaries = { time: now(), data };
    return data;
  }
  async function load(value, force = false) {
    const url = validateFeedUrl(value);
    if (pending.has(url)) return pending.get(url);
    if (!cache.has(url) && dataDirectory) {
      try {
        const filename = join(dataDirectory, 'map-feeds', `${hash(url)}.json`);
        const saved = JSON.parse(await readFile(filename, 'utf8'));
        if (saved.url === url && saved.collection?.type === 'FeatureCollection') cache.set(url, saved);
      } catch { /* No readable last-good snapshot; a fresh fetch will report any error. */ }
    }
    if (pending.has(url)) return pending.get(url);
    const previous = cache.get(url);
    if (!liveFeedsEnabled) {
      if (previous) return { ...previous, stale: true, error: 'Live feed fetching is disabled in local configuration. Showing saved data.' };
      throw fail('Live feed fetching is disabled in local configuration and no saved snapshot exists.', 503);
    }
    const attempt = attempts.get(url);
    if (attempt && now() - attempt.time < 60000 && attempt.error) {
      if (previous) return { ...previous, stale: true, error: attempt.error.message + ' Showing last successful snapshot.' };
      throw attempt.error;
    }
    const age = previous ? now() - Date.parse(previous.checkedAt) : Infinity;
    if (previous && age < (force ? 60000 : TTL)) return { ...previous, stale: Boolean(previous.error) };
    if (pending.size >= 8) throw fail('Too many feed requests. Try again shortly.', 429);
    if (cache.size >= 64 && !cache.has(url)) cache.delete(cache.keys().next().value);
    if (attempts.size >= 64 && !attempts.has(url)) attempts.delete(attempts.keys().next().value);
    attempts.set(url, { time: now(), error: null });
    const job = (async () => {
      try {
        const { raw, lastModified } = await fetcher(url);
        const parsed = parseMapFeed(raw);
        let features = parsed.features, geometrySource = null;
        if (parsed.regions) {
          const shapes = await getBoundaries();
          const unmatched = [];
          features = parsed.regions.map((region) => {
            const matches = shapes.features.filter((f) => String(f.properties.DIST_NO) === region.number && regionName(f.properties.DIST_NAME) === regionName(region.name));
            if (matches.length !== 1) unmatched.push(region.name);
            return { type: 'Feature', id: `rfs-weather-${region.number}`, geometry: matches.length === 1 ? matches[0].geometry : null,
              properties: { title: region.name, ...region, link: 'https://www.rfs.nsw.gov.au/fire-information/fdr-and-tobans' } };
          });
          geometrySource = { url: FIRE_WEATHER_GEOMETRY, attribution: 'Bureau of Meteorology fire-weather districts, distributed by Esri Australia', generalizationDegrees: 0.002 };
          parsed.warnings.push('Fire-weather ratings/bans are not permit requirements. FRNSW boundaries and year-round permits take precedence.');
          if (unmatched.length) parsed.warnings.push(`No exact region geometry match: ${unmatched.join(', ')}.`);
        }
        const result = { url, checkedAt: new Date(now()).toISOString(), sourceUpdatedAt: parsed.sourceUpdatedAt || lastModified,
          stale: false, error: null, warnings: parsed.warnings, geometrySource, collection: { type: 'FeatureCollection', features } };
        if (dataDirectory) {
          const directory = join(dataDirectory, 'map-feeds'); await mkdir(directory, { recursive: true });
          const filename = join(directory, `${hash(url)}.json`), temporary = `${filename}.tmp`;
          await writeFile(temporary, JSON.stringify(result), { mode: 0o600 }); await rename(temporary, filename);
        }
        cache.set(url, result);
        return result;
      } catch (error) {
        attempts.set(url, { time: now(), error });
        if (!previous) throw error;
        const stale = { ...previous, stale: true, error: `${error.message} Showing last successful snapshot.` };
        cache.set(url, stale);
        return stale;
      }
    })();
    pending.set(url, job);
    try { return await job; } finally { pending.delete(url); }
  }
  return { load };
}
