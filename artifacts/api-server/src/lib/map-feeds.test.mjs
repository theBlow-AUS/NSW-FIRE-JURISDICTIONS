import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMapFeedService, parseMapFeed, validateFeedUrl, isPublicAddress } from './map-feeds.mjs';

const rss = '<rss><channel><title>Local test feed</title><lastBuildDate>Thu, 29 Oct 2026 01:00:00 GMT</lastBuildDate><item><guid>first</guid><title>Point</title><georss:point>-33.8 151.2</georss:point></item><item><title>Non spatial</title><description><![CDATA[<b>Advisory only</b>]]></description></item></channel></rss>';
const danger = `<FireDangerMap>${Array.from({ length: 21 }, (_, i) => `<District><Name>Region ${i + 1}</Name><RegionNumber>${i + 1}</RegionNumber><DangerLevelToday>HIGH</DangerLevelToday><DangerLevelTomorrow>MODERATE</DangerLevelTomorrow><FireBanToday>Yes</FireBanToday><FireBanTomorrow>No</FireBanTomorrow></District>`).join('')}</FireDangerMap>`;
const shapes = { type: 'FeatureCollection', features: Array.from({ length: 21 }, (_, i) => ({
  type: 'Feature', properties: { DIST_NO: i + 1, DIST_NAME: `Region ${i + 1}` },
  geometry: { type: 'Polygon', coordinates: [[[150, -33], [151, -33], [151, -34], [150, -33]]] },
})) };

test('RSS / Atom and supported GeoRSS shapes retain non-spatial entries without inventing coordinates', () => {
  const data = parseMapFeed(rss);
  assert.deepEqual(data.features[0].geometry.coordinates, [151.2, -33.8]);
  assert.equal(data.features[1].geometry, null);
  assert.equal(data.features[1].properties.description, 'Advisory only');
  const atom = parseMapFeed('<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>a</id><title>A</title><link href="https://www.rfs.nsw.gov.au/"/><geo:lat>-34</geo:lat><geo:long>151</geo:long></entry></feed>');
  assert.deepEqual(atom.features[0].geometry.coordinates, [151, -34]);
  assert.equal(atom.features[0].properties.link, 'https://www.rfs.nsw.gov.au/');
  const polygon = parseMapFeed('<rss><channel><item><polygon>-33 150 -33 151 -34 151</polygon><line>-33 150 -34 151</line></item></channel></rss>');
  assert.equal(polygon.features[0].geometry.type, 'GeometryCollection');
});

test('unsafe URLs, private/reserved DNS addresses, entities, nonfeeds and invalid coordinates are rejected', () => {
  for (const url of ['http://www.rfs.nsw.gov.au/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://user:pass@public.site/rss', 'https://a.local/rss', 'https://public.site:8080/rss']) assert.throws(() => validateFeedUrl(url));
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2002:7f00:1::']) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('1.1.1.1'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  assert.equal(isPublicAddress('2001:4860:4860::8888'), true);
  assert.equal(isPublicAddress('2001:2::1'), false);
  assert.equal(isPublicAddress('2001:db8::1'), false);
  assert.throws(() => parseMapFeed('<!DOCTYPE foo><rss/>'), /entities/);
  assert.throws(() => parseMapFeed('<html><body>not a feed</body></html>'), /Expected RSS/);
  assert.throws(() => parseMapFeed('<rss><channel><item><point>999 151</point></item></channel></rss>'), /WGS84/);
});

test('region geometry is joined by number AND name, with attribution and explicit unmatched warnings', async () => {
  const changed = structuredClone(shapes);
  changed.features[0].properties.DIST_NAME = 'Different name';
  const service = createMapFeedService({ fetcher: async (url) => ({ raw: url.includes('FeatureServer') ? JSON.stringify(changed) : danger, lastModified: null }) });
  const data = await service.load('https://www.rfs.nsw.gov.au/feeds/fdrToban.xml');
  assert.equal(data.collection.features.length, 21);
  assert.equal(data.collection.features[0].geometry, null);
  assert.equal(data.collection.features[1].geometry.type, 'Polygon');
  assert.match(data.warnings.join(' '), /No exact region geometry match/);
  assert.match(data.geometrySource.attribution, /Bureau of Meteorology/);
  assert.equal(data.collection.features[1].properties.banToday, 'Yes');
  const actShapes = structuredClone(shapes);
  actShapes.features[7].properties.DIST_NAME = 'Australian Capital Territory';
  const actFeed = danger.replace('<Name>Region 8</Name>', '<Name>ACT</Name>');
  const actService = createMapFeedService({ fetcher: async (url) => ({ raw: url.includes('FeatureServer') ? JSON.stringify(actShapes) : actFeed }) });
  assert.equal((await actService.load('https://www.rfs.nsw.gov.au/feeds/fdrToban.xml')).collection.features[7].geometry.type, 'Polygon');
});

test('shared fetches, cooldown, stale failure fallback and persisted standalone snapshots survive restart', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'map-feed-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let clock = Date.parse('2026-10-29T01:00:00Z'), count = 0, fail = false;
  const fetcher = async () => { count++; if (fail) throw new Error('Offline fixture'); return { raw: rss, lastModified: null }; };
  const service = createMapFeedService({ dataDirectory: directory, now: () => clock, fetcher });
  const url = 'https://www.rfs.nsw.gov.au/feeds/majorIncidents.xml';
  const [first, second] = await Promise.all([service.load(url), service.load(url)]);
  assert.equal(count, 1);
  assert.equal(first.checkedAt, second.checkedAt);
  await service.load(url, true); assert.equal(count, 1);
  fail = true; clock += 20 * 60 * 1000;
  const stale = await service.load(url);
  assert.equal(stale.stale, true); assert.match(stale.error, /Offline fixture/);
  assert.equal(stale.collection.features.length, 2);
  await service.load(url); assert.equal(count, 2, 'failure cooldown prevents repeated downloads');
  const restarted = createMapFeedService({ dataDirectory: directory, now: () => clock, fetcher });
  const afterRestart = await restarted.load(url);
  assert.equal(afterRestart.stale, true);
  assert.equal(afterRestart.collection.features.length, 2);
  const calls = count;
  const offline = createMapFeedService({ dataDirectory: directory, liveFeedsEnabled: false, fetcher });
  assert.match((await offline.load(url)).error, /disabled/);
  assert.equal(count, calls, 'offline configuration must not make external feed calls');
});
