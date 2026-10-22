import { spawnSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const artifactRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(artifactRoot, '../..');
const outputRoot = resolve(workspaceRoot, 'generated-artifacts');
const bundleName = 'nsw-fire-district-checker-local';
const bundleRoot = resolve(outputRoot, bundleName);
const siteRoot = resolve(bundleRoot, 'site');
const archivePath = resolve(outputRoot, `${bundleName}.zip`);
const builtSite = resolve(artifactRoot, 'dist/public');

const files = {
  'server.mjs': `import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = resolve(fileURLToPath(new URL('./site/', import.meta.url)));
const port = Number(process.env.PORT || 5177);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a whole number between 1 and 65535.');
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Method not allowed');
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
    const filePath = resolve(siteRoot, pathname === '/' ? './index.html' : \`.\${pathname}\`);
    const pathFromRoot = relative(siteRoot, filePath);
    if (pathFromRoot === '..' || pathFromRoot.startsWith(\`..\${sep}\`) || pathFromRoot.startsWith('/')) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Forbidden');
      return;
    }
    const body = await readFile(filePath);
    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Length': body.length,
      'Content-Type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    const missing = error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
    response.writeHead(missing ? 404 : 400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(missing ? 'Not found' : 'Invalid request');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(\`NSW Fire District Checker is running at http://localhost:\${port}\`);
  console.log('This local site needs an internet connection for GURAS addresses, fire boundaries and map tiles.');
  console.log('Press Ctrl+C to stop the server.');
});
`,
  'start-local.bat': `@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or later is required. Install it from https://nodejs.org/
  pause
  exit /b 1
)
node server.mjs
pause
`,
  'start-local.sh': `#!/bin/sh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or later is required. Install it from https://nodejs.org/"
  printf "Press Enter to close."
  read _
  exit 1
fi
node server.mjs
printf "\\nPress Enter to close."
read _
`,
  'start-local.command': `#!/bin/sh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or later is required. Install it from https://nodejs.org/"
  printf "Press Enter to close."
  read _
  exit 1
fi
node server.mjs
printf "\\nPress Enter to close."
read _
`,
  'README.txt': `NSW FIRE DISTRICT CHECKER — LOCAL WEBSITE
==========================================

Start the site on your computer
-------------------------------

1. Extract this entire ZIP folder.
2. Install Node.js version 20 or later if it is not already installed:
   https://nodejs.org/
3. Start the local website:
   - Windows: double-click start-local.bat
   - macOS: double-click start-local.command
   - Linux: run ./start-local.sh in a terminal
4. Open the address printed by the launcher in your browser:
   http://localhost:5177
5. Leave the launcher window open while using the website. Press Ctrl+C in it
   when you are finished.

This is a locally hosted website, not a no-internet offline copy. It runs from
your computer and does not need an online app host or an npm install, but it
uses live NSW GURAS address search, the NSW fire-district service and
OpenStreetMap tiles. An internet connection is required for those features.
The app sends searches and map requests directly to those public services.
The fire-coverage result remains indicative and can be affected by boundary
changes. In an emergency, call 000.

If port 5177 is already in use, set PORT=5178 before starting the server.
`,
};

await mkdir(outputRoot, { recursive: true });
await rm(bundleRoot, { recursive: true, force: true });
await rm(archivePath, { force: true });
await mkdir(siteRoot, { recursive: true });
await cp(builtSite, siteRoot, { recursive: true });
for (const [name, content] of Object.entries(files)) {
  await writeFile(resolve(bundleRoot, name), content, { mode: name.endsWith('.sh') || name.endsWith('.command') ? 0o755 : 0o644 });
}

const zip = spawnSync('zip', ['-rq', archivePath, bundleName], { cwd: outputRoot, encoding: 'utf8' });
if (zip.error || zip.status !== 0) {
  throw zip.error ?? new Error(zip.stderr || `Could not create the download package (zip exit ${zip.status}).`);
}
console.log(`Created ${archivePath}`);
