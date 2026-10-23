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

// Export the persisted cache, including blocked-source warnings, without scraping.
const snapshotPath = process.argv[2];
const exportedSnapshot = snapshotPath
  ? JSON.parse(await readFile(resolve(snapshotPath), 'utf8'))
  : await (async () => {
      const response = await fetch('http://localhost:80/api/rfs/snapshot', { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('The RFS snapshot API is unavailable. Start the API server or supply a saved /api/rfs/snapshot JSON file as the first argument.');
      return response.json();
    })();
if (!Array.isArray(exportedSnapshot?.snapshot?.permitRows) || !Array.isArray(exportedSnapshot?.snapshot?.contacts)
  || !exportedSnapshot?.status?.permits) throw new Error('The supplied RFS snapshot export is invalid.');
const safeSnapshot = JSON.stringify(exportedSnapshot).replace(/</g, '\\u003c');

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
  .replace('<body>', () => `<body>\n    <script id="rfs-embedded-snapshot" type="application/json">${safeSnapshot}</script>\n    <aside id="local-host-notice" role="note">Local HTML copy · RFS permit/contact data is a dated snapshot. Internet is needed for live GURAS addresses, boundaries and NSW Spatial Services map tiles.</aside>`);

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

RFS permit and Fire Control Centre information is embedded as a dated snapshot.
The page shows the source dates and any refresh failures recorded at export.
It cannot update this data in the background. Obtain a freshly exported copy
for newer RFS information. The source reports "Fire Permit required: Yes/No",
not an independently verified BFDP Active/Inactive declaration. No is not
permission to burn and this is not a Total Fire Ban check.

FRNSW polygon coverage always takes priority over LGA-based RFS data.
The hosted updater checks the RFS permit table on Mondays at 3 am Sydney time
and on the first and last calendar day of each month at 3 am. Coinciding dates
run once. This schedule does not run inside this local HTML file.

Map tiles: NSW Base Map cached MapServer, © NSW Department of Customer Service
2020: https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Base_Map/MapServer
RFS permit table: https://www.rfs.nsw.gov.au/fire-information/BFDP
RFS contact directory: https://www.rfs.nsw.gov.au/about-us/fire-control-centres

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
