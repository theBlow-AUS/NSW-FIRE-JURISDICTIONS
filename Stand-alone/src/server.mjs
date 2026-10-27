import http from 'node:http';
import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildFireContext, lookupSpatialContext } from '@workspace/fire-data';
import { GetFireContextQueryParams, GetFireContextResponse } from '@workspace/api-zod';
import { createCache, log } from './cache.mjs';
import { createGisStore, GisError } from './gis-store.mjs';
import { createLiveFeeds, enrichDangerRatings } from './live-feeds.mjs';
export { createGisStore, createLiveFeeds };
export { parseFeed, enrichDangerRatings } from './live-feeds.mjs';

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: https://maps.six.nsw.gov.au",
  "connect-src 'self' https://maps.six.nsw.gov.au https://mapsq.six.nsw.gov.au https://portal.data.nsw.gov.au",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
};

export async function loadConfiguration(configPath, defaultsPath) {
  const filename = resolve(configPath);
  try {
    await access(filename);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!defaultsPath) throw new Error('Configuration file does not exist. Supply --defaults on first launch.');
    await mkdir(dirname(filename), { recursive: true });
    await copyFile(resolve(defaultsPath), filename, 1); // COPYFILE_EXCL: preserve administrator settings.
  }
  const config = JSON.parse(await readFile(filename, 'utf8'));
  if (typeof config.host !== 'string' || !['0.0.0.0', '127.0.0.1', '::1', '::'].includes(config.host)) {
    throw new Error('host must be 0.0.0.0, 127.0.0.1, ::1, or ::.');
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('port must be an integer from 1 to 65535.');
  if (typeof config.dataDirectory !== 'string' || !config.dataDirectory.trim()) throw new Error('dataDirectory is required.');
  if (typeof config.updaterEnabled !== 'boolean') throw new Error('updaterEnabled must be true or false.');
  if (config.liveFeedsEnabled !== undefined && typeof config.liveFeedsEnabled !== 'boolean') throw new Error('liveFeedsEnabled must be true or false.');
  if (config.feedPollingSeconds !== undefined) {
    if (!config.feedPollingSeconds || typeof config.feedPollingSeconds !== 'object' || Array.isArray(config.feedPollingSeconds) ||
        Object.values(config.feedPollingSeconds).some((value) => !Number.isInteger(value) || value < 60 || value > 604800)) {
      throw new Error('feedPollingSeconds values must be integers from 60 to 604800.');
    }
  }
  if (config.maxImportBytes !== undefined && (!Number.isSafeInteger(config.maxImportBytes) || config.maxImportBytes < 1024 || config.maxImportBytes > 32 * 1024 ** 3)) {
    throw new Error('maxImportBytes must be between 1024 bytes and 32 GiB.');
  }
  return { ...config, dataDirectory: resolve(dirname(filename), config.dataDirectory) };
}

async function readJson(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new GisError('Use application/json for this operation.');
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > 256 * 1024 * 1024) throw new GisError('The working-copy edit exceeds the 256 MiB request limit.', 413);
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw new GisError('Invalid JSON request.'); }
}

export function createApplication({ publicDirectory, cache, gis, feeds, spatialLookup = lookupSpatialContext }) {
  const publicRoot = resolve(publicDirectory);
  return http.createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(self)');
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': res.getHeader('Content-Type') || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/gis/') || url.pathname.startsWith('/api/feeds/')) {
        if (!gis || !feeds) return json(503, { error: 'The local GIS and feed services are not initialised.' });
        if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
          let origin;
          try { origin = new URL(req.headers.origin); } catch { throw new GisError('Invalid request origin.', 403); }
          if (origin.host !== req.headers.host || !['http:', 'https:'].includes(origin.protocol)) throw new GisError('Cross-origin changes to the local service are not allowed.', 403);
        }
        const p = url.pathname.split('/').filter(Boolean);
        if (url.pathname === '/api/gis/state' && ['GET', 'HEAD'].includes(req.method)) {
          return json(200, { projects: gis.list(), feeds: feeds.read() });
        }
        if (url.pathname === '/api/feeds/refresh' && req.method === 'POST') {
          await readJson(req);
          void feeds.refresh(true).catch((error) => log('error', 'Live feed refresh failed', { error: error.message }));
          return json(202, { requested: true });
        }
        if (url.pathname === '/api/feeds/export' && req.method === 'GET') {
          const snapshot = feeds.read();
          const kind = url.searchParams.get('kind') || 'incidents';
          if (!['incidents', 'updates', 'advisories', 'danger', 'manifest'].includes(kind)) throw new GisError('Unknown feed export type.');
          if (url.searchParams.get('format') === 'csv' && ['advisories', 'danger'].includes(kind)) {
            const records = kind === 'danger' ? snapshot.dangerRegions : snapshot.majorFireUpdates.features.map((feature) => feature.properties);
            const fields = [...new Set(records.flatMap((record) => Object.keys(record || {})))];
            const cell = (value) => {
              let valueText = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
              if (/^[=+\-@\t\r]/.test(valueText)) valueText = `'${valueText}`;
              return `"${valueText.replaceAll('"', '""')}"`;
            };
            const csv = [fields.map(cell).join(','), ...records.map((record) => fields.map((field) => cell(record[field])).join(','))].join('\r\n');
            res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="rfs-${kind}.csv"` });
            return res.end(csv);
          }
          res.setHeader('Content-Disposition', `attachment; filename="rfs-${kind}.${['incidents', 'updates'].includes(kind) ? 'geojson' : 'json'}"`);
          if (['incidents', 'updates'].includes(kind)) res.setHeader('Content-Type', 'application/geo+json; charset=utf-8');
          return json(200, kind === 'incidents' ? snapshot.incidents : kind === 'updates' ? snapshot.majorFireUpdates :
            kind === 'advisories' ? snapshot.majorFireUpdates.features.map((feature) => ({ id: feature.id, ...feature.properties, geometry: feature.geometry })) :
            kind === 'danger' ? snapshot.dangerRegions : { exportedAt: new Date().toISOString(), sources: snapshot.sources,
              note: 'Incident geometry is WGS84. Fire danger ratings and bans are regional advisories, not a permit determination.' });
        }
        if (url.pathname === '/api/gis/projects' && req.method === 'POST') return json(201, await gis.create((await readJson(req)).name));
        if (p[1] === 'gis' && p[2] === 'projects' && p[3]) {
          const projectId = p[3];
          if (p.length === 4 && req.method === 'PUT') return json(200, await gis.rename(projectId, (await readJson(req)).name));
          if (p.length === 4 && req.method === 'DELETE') return json(200, await gis.remove(projectId));
          if (p.length === 5 && p[4] === 'import' && req.method === 'POST') return json(200, await gis.importFiles(projectId, req));
          if (p[4] === 'layers' && p[5]) {
            const layerId = p[5];
            if (p.length === 6 && req.method === 'GET') return json(200, await gis.getLayer(projectId, layerId));
            if (p.length === 6 && req.method === 'PUT') return json(200, await gis.saveLayer(projectId, layerId, await readJson(req)));
            if (p.length === 6 && req.method === 'DELETE') return json(200, await gis.removeLayer(projectId, layerId));
            if (p.length === 7 && p[6] === 'export' && req.method === 'GET') {
              const councilField = url.searchParams.get('councilField');
              const current = councilField ? await gis.getLayer(projectId, layerId) : null;
              if (councilField && !current.fields.includes(councilField)) throw new GisError('The selected council field does not exist.');
              const feedState = feeds.read();
              const exported = await gis.exportLayer(projectId, layerId, councilField ? (data) => enrichDangerRatings(data, feedState.dangerRegions, councilField,
                feedState.sources.filter((source) => source.id.startsWith('danger-'))) : null);
              if (url.searchParams.get('manifest') === '1') {
                res.setHeader('Content-Disposition', `attachment; filename="${exported.name}.manifest.json"`);
                return json(200, exported.manifest);
              }
              res.setHeader('Content-Disposition', `attachment; filename="${exported.name}"`);
              res.setHeader('Content-Type', 'application/geo+json; charset=utf-8');
              return json(200, exported.data);
            }
          }
        }
        return json(404, { error: 'Local workspace route not found.' });
      }
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD');
        return json(405, { error: 'Method not allowed.' });
      }
      if (url.pathname === '/api/healthz') return json(200, { status: 'ok' });
      if (url.pathname === '/api/rfs/status') return json(200, cache.read().status);
      if (url.pathname === '/api/rfs/snapshot') return json(200, cache.read());
      if (url.pathname === '/api/fire-context') {
        const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
        const coordinates = Object.fromEntries(['latitude', 'longitude'].map((key) => [key, url.searchParams.get(key)]));
        if (!Object.values(coordinates).every((value) => typeof value === 'string' && decimal.test(value.trim()))) {
          return json(400, { error: 'Valid decimal latitude and longitude are required.' });
        }
        const parsed = GetFireContextQueryParams.safeParse(coordinates);
        if (!parsed.success) return json(400, { error: 'Valid decimal latitude and longitude are required.' });
        const spatial = await spatialLookup(parsed.data.latitude, parsed.data.longitude);
        const { snapshot, status } = cache.read();
        return json(200, GetFireContextResponse.parse(buildFireContext(spatial, snapshot, status)));
      }
      if (url.pathname.startsWith('/api/')) return json(404, { error: 'Not found.' });
      const decoded = decodeURIComponent(url.pathname);
      if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) {
        return json(400, { error: 'Invalid path.' });
      }
      const relative = ['/', '/workspace'].includes(decoded) ? 'index.html' : decoded.replace(/^\/+/, '');
      if (isAbsolute(relative)) return json(400, { error: 'Invalid path.' });
      const filename = resolve(publicRoot, relative);
      if (!filename.startsWith(`${publicRoot}${sep}`)) return json(403, { error: 'Access denied.' });
      let file;
      try {
        file = await stat(filename);
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return json(404, { error: 'Not found.' });
        throw error;
      }
      if (!file.isFile()) return json(404, { error: 'Not found.' });
      res.writeHead(200, {
        'Content-Type': MIME[extname(filename)] ?? 'application/octet-stream',
        'Content-Length': file.size,
        'Cache-Control': extname(filename) === '.html' ? 'no-cache' : 'public, max-age=3600',
      });
      if (req.method === 'HEAD') return res.end();
      const stream = createReadStream(filename);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    } catch (error) {
      if (error instanceof GisError && !res.headersSent) return json(error.status, { error: error.message });
      log('error', 'Request failed', { error: error.message });
      if (!res.headersSent) json(500, { error: 'The local service could not complete this request. Check the service log.' });
      else res.destroy();
    }
  });
}

export async function main(args = process.argv.slice(2)) {
  const values = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--refresh-rfs') values.refresh = true;
    else if (['--config', '--defaults'].includes(args[i]) && args[i + 1]) values[args[i].slice(2)] = args[++i];
    else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
  }
  if (!values.config) throw new Error('--config is required.');
  const config = await loadConfiguration(values.config, values.defaults);
  const cache = createCache(config);
  await cache.initialise();
  if (values.refresh) {
    process.exitCode = await cache.refresh(true) ? 0 : 1;
    return;
  }
  const publicDirectory = join(dirname(fileURLToPath(import.meta.url)), 'public');
  const gis = createGisStore(config);
  const feeds = createLiveFeeds(config);
  await Promise.all([gis.initialise(), feeds.initialise()]);
  const server = createApplication({ publicDirectory, cache, gis, feeds });
  server.requestTimeout = 20 * 60 * 1000;
  server.headersTimeout = 15000;
  server.maxHeadersCount = 50;
  server.on('error', (error) => { log('error', 'Local server failed', { error: error.message }); process.exitCode = 1; cache.stop(); });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, done);
  });
  log('info', 'NSW Fire Coverage local server started', { host: config.host, port: config.port });
  if (config.updaterEnabled) cache.start();
  feeds.start();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    cache.stop();
    feeds.stop();
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), 25000).unref();
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    log('error', 'Local service could not start', { error: error.message });
    process.exitCode = 1;
  });
}
