import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateWxs } from '../installer/generate-wxs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = join(root, 'Stand-alone');
const sharedOnly = process.argv.includes('--shared-only');
const output = join(root, sharedOnly ? 'generated-artifacts/standalone-macos/shared' : 'generated-artifacts/standalone');
const payload = join(output, 'payload');
const frontend = join(root, 'artifacts/nsw-fire-district-checker');
const api = join(root, 'artifacts/api-server');
const frontendRequire = createRequire(join(frontend, 'package.json'));
const backendRequire = createRequire(join(api, 'package.json'));
const lock = JSON.parse(await readFile(join(source, 'dependencies.lock.json'), 'utf8'));
const version = process.env.INSTALLER_VERSION || '1.1.0';
if (!/^\d{1,3}\.\d{1,3}\.\d{1,5}$/.test(version)) throw new Error('INSTALLER_VERSION must be a three-part MSI version.');
const versionParts = version.split('.').map(Number);
if (versionParts[0] > 255 || versionParts[1] > 255 || versionParts[2] > 65535) throw new Error('MSI version limits are 255.255.65535.');
const artifactName = `NSW-Fire-Coverage-${version}-x64.msi`;
const downloadDirectory = join(output, 'downloads');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
await mkdir(downloadDirectory, { recursive: true });
await rm(payload, { recursive: true, force: true });
await mkdir(join(payload, 'runtime'), { recursive: true });

async function download(dependency) {
  const filename = join(downloadDirectory, basename(new URL(dependency.url).pathname));
  let bytes;
  try { bytes = await readFile(filename); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!bytes) {
    const response = await fetch(dependency.url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${dependency.url}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(filename, bytes);
  }
  if (hash(bytes) !== dependency.sha256) throw new Error(`Checksum mismatch: ${filename}. Remove this file and investigate; do not disable verification.`);
  return filename;
}
if (!sharedOnly) {
const [nodeZip, wrapper] = await Promise.all([download(lock.node), download(lock.winsw)]);
execFileSync('python3', ['-c', `
import sys,zipfile,pathlib
archive,out,version=sys.argv[1:]
with zipfile.ZipFile(archive) as z:
    prefix='node-v'+version+'-win-x64/'
    for src,dst in [('node.exe','node.exe'),('LICENSE','NODE-LICENSE.txt')]:
        pathlib.Path(out,dst).write_bytes(z.read(prefix+src))
`, nodeZip, join(payload, 'runtime'), lock.node.version]);
await cp(wrapper, join(payload, 'NSWFireCoverage.exe'));
await cp(join(source, 'service/NSWFireCoverage.xml'), join(payload, 'NSWFireCoverage.xml'));
await cp(join(source, 'config'), join(payload, 'config'), { recursive: true });
await cp(join(source, 'operator'), join(payload, 'operator'), { recursive: true });
await cp(join(source, 'README.md'), join(payload, 'README.md'));
await writeFile(join(payload, 'Open Checker.url'), '[InternetShortcut]\r\nURL=http://localhost:8080/\r\n');
const licenseResponse = await fetch(lock.winsw.licenseUrl);
if (!licenseResponse.ok) throw new Error(`WinSW licence fetch failed: ${licenseResponse.status}`);
await writeFile(join(payload, 'WINSW-LICENSE.txt'), await licenseResponse.text());
}

const importFrom = async (require, name) => import(pathToFileURL(require.resolve(name)).href);
await cp(join(source, 'GIS-WORKSPACE.md'), join(payload, 'GIS-WORKSPACE.md'));
await cp(join(source, 'GIS-LARGE-LAYERS.md'), join(payload, 'GIS-LARGE-LAYERS.md'));
const [{ build: viteBuild }, { default: react }, { default: tailwindcss }] = await Promise.all([
  importFrom(frontendRequire, 'vite'), importFrom(frontendRequire, '@vitejs/plugin-react'), importFrom(frontendRequire, '@tailwindcss/vite'),
]);
const frontendModules = new Set();
await viteBuild({
  configFile: false,
  root: frontend,
  base: '/',
  mode: 'production',
  define: { 'import.meta.env.VITE_STANDALONE_MODE': JSON.stringify('true') },
  resolve: {
    alias: { '@': join(frontend, 'src'), '@assets': join(root, 'attached_assets') },
    dedupe: ['react', 'react-dom'],
  },
  plugins: [
    {
      name: 'standalone-no-external-fonts',
      enforce: 'pre',
      transformIndexHtml: (html) => html.replace(/<link\b[^>]*href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>\s*/gi, ''),
      transform(code, filename) {
        if (filename === join(frontend, 'src/App.tsx')) {
          return code.replace('The hosted RFS information service could not be reached.', 'The local permit and coverage service could not be reached.');
        }
        if (filename !== join(frontend, 'src/index.css')) return;
        return code.replace(/@import url\('https:\/\/fonts\.googleapis\.com[^']*'\);\s*/g, '')
          .replace("--app-font-sans: 'DM Sans', sans-serif;", "--app-font-sans: 'Segoe UI', system-ui, sans-serif;")
          .replace("--app-font-display: 'Manrope', sans-serif;", "--app-font-display: 'Segoe UI', system-ui, sans-serif;")
          .replace("--app-font-mono: 'Space Mono', monospace;", "--app-font-mono: Consolas, monospace;");
      },
      generateBundle() { for (const module of this.getModuleIds()) frontendModules.add(module); },
    },
    react(),
    tailwindcss(),
  ],
  build: { outDir: join(payload, 'app/public'), emptyOutDir: true, sourcemap: false },
});

const { build: esbuild } = backendRequire('esbuild');
const serverBuild = await esbuild({
  entryPoints: [join(source, 'src/server.mjs'), join(source, 'src/cache.mjs'), join(source, 'src/gis-worker.mjs')],
  outdir: join(payload, 'app'),
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  nodePaths: [join(api, 'node_modules')],
  minify: false,
  sourcemap: false,
  metafile: true,
  legalComments: 'inline',
  alias: {
    '@workspace/fire-data': join(root, 'lib/fire-data/src/index.ts'),
    '@workspace/api-zod': join(root, 'lib/api-zod/src/index.ts'),
    '@standalone/rfs-scrape': join(api, 'src/rfs/scrape.ts'),
  },
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});

// The portable engine is already a self-contained CommonJS bundle plus WASM/data.
// Keep it replaceable and separate from our bundle (LGPL); no target GDAL install.
const engineRoot = dirname(backendRequire.resolve('gdal3.js/node'));
const engineLock = JSON.parse(await readFile(join(source, 'gdal.lock.json'), 'utf8'));
if (JSON.parse(await readFile(join(engineRoot, 'package.json'), 'utf8')).version !== engineLock.version) throw new Error('Unexpected portable GDAL package version.');
const engineTarget = join(payload, 'app/vendor/gdal');
await mkdir(engineTarget, { recursive: true });
for (const name of ['gdal3.node.js', 'gdal3WebAssembly.data', 'gdal3WebAssembly.wasm']) {
  if (hash(await readFile(join(engineRoot, 'dist/package', name))) !== engineLock.files[name]) throw new Error(`Portable GDAL checksum mismatch: ${name}`);
  await cp(join(engineRoot, 'dist/package', name), join(engineTarget, name));
}
await cp(join(engineRoot, 'package.json'), join(engineTarget, 'upstream-package.json'));
for (const name of (await readdir(engineRoot)).filter((name) => /^(license|copying|notice)(\.|$)/i.test(name))) {
  await cp(join(engineRoot, name), join(engineTarget, name));
}
await writeFile(join(engineTarget, 'SOURCE.txt'), [
  'Unmodified gdal3.js 2.8.1, LGPL-2.1-or-later.',
  `Corresponding source and build scripts: ${engineLock.source}`,
  'Library files are separate and may be replaced with a compatible build.',
  'GDAL/PROJ and other compiled components have their own upstream licenses.',
].join('\n'));

// Retain upstream notices for every packaged third-party dependency used by either bundle.
const licenses = new Map();
for (const module of [...frontendModules, ...Object.keys(serverBuild.metafile.inputs).map((path) => resolve(root, path))]) {
  if (!module.includes('node_modules') || module.startsWith('\0')) continue;
  let directory = dirname(module.split('?')[0]);
  while (directory !== dirname(directory) && directory.includes('node_modules')) {
    try {
      const packageInfo = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (packageInfo.name && packageInfo.version) {
        const key = `${packageInfo.name}@${packageInfo.version}`;
        if (!licenses.has(key)) {
          const files = (await readdir(directory)).filter((name) => /^(license|licence|copying|notice)(\.|$)/i.test(name));
          const texts = [];
          for (const name of files) { try { texts.push(await readFile(join(directory, name), 'utf8')); } catch {} }
          licenses.set(key, `${key} (${packageInfo.license || 'see upstream package'})\n${texts.join('\n') || packageInfo.repository?.url || packageInfo.homepage || ''}`);
        }
        break;
      }
    } catch {}
    directory = dirname(directory);
  }
}
await writeFile(join(payload, 'THIRD-PARTY-NOTICES.txt'), [
  'Node.js licence: runtime/NODE-LICENSE.txt',
  ...(sharedOnly ? [] : ['WinSW licence: WINSW-LICENSE.txt']),
  'The application data remains subject to the official NSW source terms and attribution.',
  'Portable GDAL/OGR: app/vendor/gdal. gdal3.js 2.8.1 (LGPL-2.1-or-later); source and replacement information: app/vendor/gdal/SOURCE.txt.',
  ...[...licenses.values()].sort(),
].join('\n\n' + '='.repeat(72) + '\n\n'));

async function files(directory) {
  const all = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) all.push(...await files(filename));
    else all.push(filename);
  }
  return all;
}
const records = [];
for (const filename of await files(payload)) {
  const bytes = await readFile(filename);
  const name = relative(payload, filename).replaceAll('\\', '/');
  if (/\.(js|mjs|html|css)$/.test(name)) {
    const text = bytes.toString('utf8');
    if (/https?:\/\/[^"'\s<>]*(?:replit\.(?:com|app|dev)|repl\.co)|\/@vite\/client|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(text)) {
      throw new Error(`Unexpected development, Replit, or remote-font reference in ${name}`);
    }
  }
  records.push({ path: name, sha256: hash(bytes), bytes: bytes.length });
}
await writeFile(join(payload, 'BUILD-MANIFEST.json'), JSON.stringify({
  version, architecture: sharedOnly ? 'runtime-independent' : 'x64', builtAt: new Date().toISOString(),
  nodeVersion: lock.node.version, winswVersion: sharedOnly ? null : lock.winsw.version,
  runtimeNetwork: 'Local server plus official NSW public services only; no Replit endpoints.',
  files: records,
}, null, 2));
if (!sharedOnly) await generateWxs({ payload, outputFile: join(output, 'product.wxs'), version });
if (!sharedOnly && !process.argv.includes('--skip-msi')) {
  execFileSync('wixl', ['-a', 'x64', '-o', artifactName, 'product.wxs'], { cwd: output, stdio: 'inherit' });
  const msi = join(output, artifactName);
  const digest = hash(await readFile(msi));
  await writeFile(join(output, `${artifactName}.sha256`), `${digest}  ${artifactName}\n`);
  const distribution = join(source, 'dist');
  await mkdir(distribution, { recursive: true });
  for (const name of [artifactName, `${artifactName}.sha256`]) await cp(join(output, name), join(distribution, name));
  process.stdout.write(`MSI created: ${msi}\nSHA256: ${digest}\n`);
}
process.stdout.write(`Payload created: ${payload}\n`);
