import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const artifactRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(artifactRoot, '../..');
const builtRoot = resolve(artifactRoot, 'dist/public');
const localHostRoot = resolve(artifactRoot, 'LOCAL HOST');
const outputRoot = resolve(workspaceRoot, 'generated-artifacts');
const archivePath = resolve(outputRoot, 'NSW-Fire-District-Checker-LOCAL-HOST.zip');

const builtHtml = await readFile(resolve(builtRoot, 'index.html'), 'utf8');
const jsAsset = builtHtml.match(/<script\b[^>]*\bsrc="([^"]+\.js)"[^>]*><\/script>/i)?.[1];
const cssAsset = builtHtml.match(/<link\b[^>]*\bhref="([^"]+\.css)"[^>]*>/i)?.[1];
if (!jsAsset || !cssAsset) {
  throw new Error('Could not locate the built app JavaScript and CSS files.');
}

const bundleScript = await readFile(resolve(builtRoot, jsAsset.replace(/^\//, '')), 'utf8');
const bundleStyle = await readFile(resolve(builtRoot, cssAsset.replace(/^\//, '')), 'utf8');
const favicon = await readFile(resolve(builtRoot, 'favicon.svg'));
const faviconDataUri = `data:image/svg+xml;base64,${favicon.toString('base64')}`;
const safeScript = bundleScript.replace(/<\/script/gi, '<\\/script');
const selfContainedStyle = bundleStyle.replace(/@import\s*(?:url\(\s*)?(["'])https:\/\/fonts\.googleapis\.com\/[^"']*\1\s*\)?\s*;?/gi, '');
const localNotice = `  <style>
    #local-host-notice {
      box-sizing: border-box;
      padding: 8px 16px;
      border-bottom: 1px solid #e8dac4;
      background: #f5ecd8;
      color: #334155;
      font: 12px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
      text-align: center;
    }
  </style>
`;

let standaloneHtml = builtHtml
  .replace(/^\s*<link\b(?=[^>]*href="https:\/\/fonts\.(?:googleapis|gstatic)\.com)[^>]*>\s*$/gmi, '')
  .replace(/<link\b[^>]*\brel="icon"[^>]*>/i, () => `<link rel="icon" type="image/svg+xml" href="${faviconDataUri}" />`)
  .replace(/<link\b[^>]*\brel="stylesheet"[^>]*>/i, () => `<style>\n${selfContainedStyle}\n</style>`)
  .replace(/<script\b[^>]*\bsrc="[^"]+\.js"[^>]*><\/script>/i, () => `<script type="module">\n${safeScript}\n</script>`)
  .replace('</head>', () => `${localNotice}</head>`)
  .replace('<body>', '<body>\n    <aside id="local-host-notice" role="note">Local HTML copy · Internet is needed for live GURAS addresses, fire coverage and NSW Spatial Services map tiles.</aside>');

const htmlShell = standaloneHtml.replace(/<script type="module">[\s\S]*?<\/script>/i, '');
if (/<script\b[^>]*\bsrc=/i.test(htmlShell) || /<link\b[^>]*href="\/assets\//i.test(htmlShell)) {
  throw new Error('The standalone page still depends on a separate local script or stylesheet.');
}

await mkdir(localHostRoot, { recursive: true });
await writeFile(resolve(localHostRoot, 'index.html'), standaloneHtml);
await writeFile(resolve(localHostRoot, 'README.txt'), `NSW FIRE DISTRICT CHECKER — LOCAL HTML
=======================================

Open index.html in your web browser. No installation, server, or other local
files are needed.

This page is a single, self-contained HTML file. It makes direct requests to
the NSW GURAS address service, the NSW fire-district service, and NSW Spatial
Services map tiles. An internet connection is required for address searches,
coverage results, and map tiles. Requests go directly from your browser to
those public services.

Map tiles: NSW Base Map cached MapServer, © NSW Department of Customer Service
2020: https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Base_Map/MapServer

FRNSW/RFD coverage is indicative, may not reflect boundary changes, and does
not confirm emergency arrangements. In an emergency, call 000.
`);

await mkdir(outputRoot, { recursive: true });
// Remove the superseded Node-based package created for the previous delivery.
await rm(resolve(outputRoot, 'nsw-fire-district-checker-local'), { recursive: true, force: true });
await rm(resolve(outputRoot, 'nsw-fire-district-checker-local.zip'), { force: true });
await rm(archivePath, { force: true });

const zip = spawnSync('zip', ['-rq', archivePath, 'LOCAL HOST'], {
  cwd: artifactRoot,
  encoding: 'utf8',
});
if (zip.error || zip.status !== 0) {
  throw zip.error ?? new Error(zip.stderr || `Could not create the ZIP download (exit ${zip.status}).`);
}
console.log(`Created ${resolve(localHostRoot, 'index.html')}`);
console.log(`Created ${archivePath}`);
