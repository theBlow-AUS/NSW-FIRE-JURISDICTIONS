import http from 'node:http';
import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildFireContext, lookupSpatialContext } from '@workspace/fire-data';
import { GetFireContextQueryParams, GetFireContextResponse } from '@workspace/api-zod';
import { createCache, log } from './cache.mjs';

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
  return { ...config, dataDirectory: resolve(dirname(filename), config.dataDirectory) };
}

export function createApplication({ publicDirectory, cache, spatialLookup = lookupSpatialContext }) {
  const publicRoot = resolve(publicDirectory);
  return http.createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(self)');
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data));
    };
    try {
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD');
        return json(405, { error: 'Method not allowed.' });
      }
      const url = new URL(req.url, 'http://localhost');
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
      const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
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
  const server = createApplication({ publicDirectory, cache });
  server.requestTimeout = 60000;
  server.headersTimeout = 15000;
  server.maxHeadersCount = 50;
  server.on('error', (error) => { log('error', 'Local server failed', { error: error.message }); process.exitCode = 1; cache.stop(); });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, done);
  });
  log('info', 'NSW Fire Coverage local server started', { host: config.host, port: config.port });
  if (config.updaterEnabled) cache.start();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    cache.stop();
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
