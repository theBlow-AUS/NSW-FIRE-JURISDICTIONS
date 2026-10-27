import { mkdir, readFile, rename, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import xml from 'xml-js';
import { validateCollection } from './gis-store.mjs';

export const FEED_SOURCES = [
  { id: 'incidents-json', name: 'Current incidents · GeoJSON', file: 'majorIncidents.json', interval: 900 },
  { id: 'incidents-xml', name: 'Current incidents · GeoRSS', file: 'majorIncidents.xml', interval: 900 },
  { id: 'danger-xml', name: 'Fire danger and total fire bans · XML', file: 'fdrToban.xml', interval: 3600 },
  { id: 'danger-rss', name: 'Fire danger and total fire bans · RSS', file: 'fdrTobanRSS.xml', interval: 3600 },
  { id: 'major-updates', name: 'Major Fire Updates · RSS', file: 'major-Fire-Updates.xml', interval: 900 },
].map((source) => ({ ...source, url: `https://www.rfs.nsw.gov.au/feeds/${source.file}` }));

const collection = (features = []) => ({ type: 'FeatureCollection', features });
const list = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
const text = (value) => typeof value === 'string' ? value : value == null ? '' :
  list(value._text ?? value._cdata).join('');
const plain = (value) => text(value).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();
const key = (value) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

function parseXml(raw) {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(raw)) throw new Error('XML declarations or external entities are not accepted.');
  return xml.xml2js(raw, { compact: true, trim: true, ignoreComment: true });
}

function rssItems(document) {
  return list(document.rss?.channel?.item ?? document.feed?.entry);
}

function pointFromItem(item) {
  const pair = text(item['georss:point'] ?? item.point).trim().split(/\s+/).map(Number);
  const lat = Number(text(item['geo:lat']));
  const lon = Number(text(item['geo:long']));
  if (pair.length === 2 && pair.every(Number.isFinite) && Math.abs(pair[0]) <= 90 && Math.abs(pair[1]) <= 180) {
    return { type: 'Point', coordinates: [pair[1], pair[0]] };
  }
  if (item['geo:lat'] && item['geo:long'] && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    return { type: 'Point', coordinates: [lon, lat] };
  }
  return null;
}

function geometryFromItem(item) {
  const geometries = [];
  const point = pointFromItem(item);
  if (point) geometries.push(point);
  for (const polygon of list(item['georss:polygon'] ?? item.polygon)) {
    const numbers = text(polygon).trim().split(/\s+/).map(Number);
    if (numbers.length < 8 || numbers.length % 2 || numbers.some((n) => !Number.isFinite(n))) continue;
    const ring = [];
    for (let i = 0; i < numbers.length; i += 2) ring.push([numbers[i + 1], numbers[i]]);
    if (ring.some(([lon, lat]) => Math.abs(lon) > 180 || Math.abs(lat) > 90)) continue;
    if (JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1))) ring.push([...ring[0]]);
    geometries.push({ type: 'Polygon', coordinates: [ring] });
  }
  return geometries.length > 1 ? { type: 'GeometryCollection', geometries } : geometries[0] || null;
}

export function enrichDangerRatings(data, regions, field, sources) {
  const byCouncil = new Map();
  for (const region of regions) for (const council of region.councils) {
    const normalized = key(council);
    byCouncil.set(normalized, [...(byCouncil.get(normalized) || []), region]);
  }
  const counts = { matched: 0, unmatched: 0, ambiguous: 0 };
  const features = data.features.map((feature) => {
    const matches = byCouncil.get(key(feature.properties?.[field])) || [];
    const status = matches.length === 1 ? 'matched' : matches.length > 1 ? 'ambiguous' : 'unmatched';
    counts[status] += 1;
    const region = status === 'matched' ? matches[0] : null;
    return { ...feature, properties: { ...feature.properties, _rfsJoinStatus: status,
      ...(region ? { _rfsRegion: region.name, _rfsDangerToday: region.dangerToday, _rfsDangerTomorrow: region.dangerTomorrow,
        _rfsFireBanToday: region.fireBanToday, _rfsFireBanTomorrow: region.fireBanTomorrow,
        _rfsFeedStatus: sources } : {}) } };
  });
  return { data: { ...data, features }, provenance: {
    councilField: field, matching: 'Exact council-name equality after case/punctuation normalization. No inferred geography.',
    counts, sources, warning: 'Regional fire danger and bans are not a permit determination. FRNSW coverage and year-round permits take precedence.',
  } };
}

export function parseFeed(sourceId, raw) {
  if (sourceId === 'incidents-json') {
    const data = JSON.parse(raw);
    if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Expected an incident FeatureCollection.');
    if (data.features.some((feature) => feature.type !== 'Feature' || !feature.properties || typeof feature.properties !== 'object')) {
      throw new Error('Invalid incident features; the previous snapshot is retained.');
    }
    validateCollection(data);
    return { features: data.features, sourceUpdatedAt: null }; // Individual pubDate values are retained; no invented feed-wide timestamp.
  }
  const document = parseXml(raw);
  const sourceUpdatedAt = text(document.rss?.channel?.lastBuildDate ?? document.rss?.channel?.pubDate ?? document.feed?.updated) || null;
  if (sourceId === 'danger-xml') {
    if (!document.FireDangerMap) throw new Error('Expected the RFS FireDangerMap XML document.');
    const regions = list(document.FireDangerMap.District).map((district) => ({
      id: text(district.RegionNumber) || key(text(district.Name)),
      regionNumber: text(district.RegionNumber) || null,
      name: text(district.Name),
      councils: text(district.Councils).split(';').map((v) => v.trim()).filter(Boolean),
      dangerToday: text(district.DangerLevelToday) || null,
      dangerTomorrow: text(district.DangerLevelTomorrow) || null,
      fireBanToday: text(district.FireBanToday) || null,
      fireBanTomorrow: text(district.FireBanTomorrow) || null,
    }));
    if (regions.length < 10 || regions.some((region) => !region.name)) throw new Error('The fire danger response is incomplete.');
    return { regions, sourceUpdatedAt };
  }
  if (!document.rss?.channel && !document.feed) throw new Error('Expected an RSS/Atom document.');
  const items = rssItems(document);
  if (sourceId === 'danger-rss') {
    const regions = items.map((item) => {
      const description = plain(item.description ?? item.summary);
      const field = (name) => description.match(new RegExp(`${name}:\\s*([^\\n]*?)(?=\\s+(?:REGIONNUMBER|COUNCILS|DANGERLEVELTODAY|DANGERLEVELTOMORROW|FIREBANTODAY|FIREBANTOMORROW):|$|\\n)`, 'i'))?.[1]?.trim().replace(/["']$/, '') || null;
      return {
        id: field('REGIONNUMBER') || key(text(item.title)), name: text(item.title), regionNumber: field('REGIONNUMBER'),
        councils: (field('COUNCILS') || '').split(';').map((v) => v.trim()).filter(Boolean),
        dangerToday: field('DANGERLEVELTODAY'), dangerTomorrow: field('DANGERLEVELTOMORROW'),
        fireBanToday: field('FIREBANTODAY'), fireBanTomorrow: field('FIREBANTOMORROW'),
      };
    });
    if (regions.length < 10) throw new Error('The fire danger RSS response is incomplete.');
    return { regions, sourceUpdatedAt };
  }
  return {
    sourceUpdatedAt,
    features: items.map((item, index) => {
      const guid = text(item.guid ?? item.id) || text(item.link) || `${sourceId}-${index}`;
      return {
        type: 'Feature', id: guid, geometry: geometryFromItem(item),
        properties: {
          guid, title: text(item.title), link: text(item.link),
          description: plain(item.description ?? item.summary),
          category: text(list(item.category)[0]), pubDate: text(item.pubDate ?? item.updated),
        },
      };
    }),
  };
}

async function limitedText(response) {
  const reader = response.body.getReader();
  const parts = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16 * 1024 * 1024) throw new Error('The feed exceeded the 16 MiB safety limit.');
      parts.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(parts).toString('utf8');
}

export function createLiveFeeds({ dataDirectory, liveFeedsEnabled = true, feedPollingSeconds = {}, fetcher = fetch, now = () => new Date() }) {
  const directory = join(dataDirectory, 'live-feeds');
  const entries = new Map();
  let timer;
  let running = null;
  const interval = (source) => Math.max(60, feedPollingSeconds[source.id] || source.interval) * 1000;
  const persist = async (source, entry) => {
    const filename = join(directory, `${source.id}.json`);
    const temporary = `${filename}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(entry), { mode: 0o600 });
    await rename(temporary, filename);
  };
  function read() {
    const sources = FEED_SOURCES.map((source) => {
      const entry = entries.get(source.id);
      return {
        id: source.id, name: source.name, url: source.url,
        lastAttemptAt: entry.lastAttemptAt, lastSuccessAt: entry.lastSuccessAt,
        sourceUpdatedAt: entry.sourceUpdatedAt,
        nextFetchAt: liveFeedsEnabled && entry.lastAttemptAt ? new Date(Date.parse(entry.lastAttemptAt) + interval(source)).toISOString() : null,
        featureCount: entry.data?.features?.length ?? entry.data?.regions?.length ?? 0,
        stale: !entry.lastSuccessAt || Boolean(entry.error) || now().getTime() - Date.parse(entry.lastSuccessAt) > interval(source) * 2,
        error: [entry.error, liveFeedsEnabled ? null : 'Live feed polling is disabled in local configuration.'].filter(Boolean).join(' ') || null,
      };
    });
    const annotate = (features, source) => features.map((feature, index) => ({
      ...feature, id: feature.id ?? feature.properties?.guid ?? `${source.id}-${index}`,
      properties: { ...feature.properties, _source: source.url, _sourceUpdatedAt: entries.get(source.id).sourceUpdatedAt,
        _lastCheckedAt: entries.get(source.id).lastSuccessAt, _stale: sources.find((s) => s.id === source.id).stale },
    }));
    const incidents = new Map();
    for (const id of ['incidents-json', 'incidents-xml']) {
      const source = FEED_SOURCES.find((s) => s.id === id);
      for (const feature of annotate(entries.get(id).data?.features || [], source)) {
        const guid = String(feature.properties?.guid || feature.id);
        if (!incidents.has(guid)) incidents.set(guid, feature);
      }
    }
    const dangerRegions = entries.get('danger-xml').data?.regions || entries.get('danger-rss').data?.regions || [];
    return {
      sources, incidents: collection([...incidents.values()]),
      majorFireUpdates: collection(annotate(entries.get('major-updates').data?.features || [], FEED_SOURCES[4])),
      dangerRegions: structuredClone(dangerRegions),
    };
  }
  async function initialise() {
    await mkdir(directory, { recursive: true });
    for (const source of FEED_SOURCES) {
      let entry = { lastAttemptAt: null, lastSuccessAt: null, sourceUpdatedAt: null, error: 'No successful fetch on this installation yet.', data: null, etag: null, lastModified: null };
      try {
        const disk = JSON.parse(await readFile(join(directory, `${source.id}.json`), 'utf8'));
        if (disk.raw != null && typeof disk.raw !== 'string') throw new Error('Invalid saved feed.');
        if (!disk.raw && disk.lastSuccessAt) throw new Error('Saved feed is missing its last successful raw response.');
        entry = { ...entry, ...disk, data: disk.raw ? parseFeed(source.id, disk.raw) : null };
      } catch (error) {
        if (error.code !== 'ENOENT') {
          await copyFile(join(directory, `${source.id}.json`), join(directory, `${source.id}.invalid-${Date.now()}.json`)).catch(() => {});
          entry.error = 'The saved feed could not be validated. The original cache was preserved for the administrator.';
        }
      }
      entries.set(source.id, entry);
    }
    return read();
  }
  async function refresh(force = false) {
    if (running) return running;
    running = (async () => {
      await Promise.all(FEED_SOURCES.map(async (source) => {
        const entry = entries.get(source.id);
        if (force && entry.lastAttemptAt && now().getTime() - Date.parse(entry.lastAttemptAt) < 60000) return;
        if (!force && entry.lastAttemptAt && now().getTime() - Date.parse(entry.lastAttemptAt) < interval(source)) return;
        entry.lastAttemptAt = now().toISOString();
        try {
          const headers = { Accept: 'application/json, application/xml, text/xml', 'User-Agent': 'NSW-Fire-Coverage-Standalone/1.1' };
          if (entry.etag) headers['If-None-Match'] = entry.etag;
          if (entry.lastModified) headers['If-Modified-Since'] = entry.lastModified;
          const response = await fetcher(source.url, { headers, redirect: 'error', signal: AbortSignal.timeout(25000) });
          if (response.status !== 304) {
            if (!response.ok) throw new Error(`Official RFS feed returned HTTP ${response.status}.`);
            const raw = await limitedText(response);
            const data = parseFeed(source.id, raw);
            entry.data = data;
            entry.raw = raw;
            entry.sourceUpdatedAt = data.sourceUpdatedAt || response.headers.get('last-modified') || null;
            entry.etag = response.headers.get('etag');
            entry.lastModified = response.headers.get('last-modified');
          } else if (!entry.data) throw new Error('The source returned 304 without an existing local snapshot.');
          entry.lastSuccessAt = now().toISOString();
          entry.error = null;
        } catch (error) {
          entry.error = `${error.message} Last successful data is retained; do not treat cached information as current.`;
        }
        await persist(source, entry);
      }));
      return read();
    })();
    try { return await running; } finally { running = null; }
  }
  return {
    initialise, read, refresh,
    start() {
      if (!liveFeedsEnabled) return;
      const poll = () => { void refresh().catch((error) => console.error('Live feed cache write failed:', error.message)); };
      poll(); timer = setInterval(poll, 60000); timer.unref();
    },
    stop() { clearInterval(timer); },
  };
}
