import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const source = join(root, 'Stand-alone/macOS');
const output = join(root, 'generated-artifacts/standalone-macos');
const tree = join(output, 'root');
const app = join(tree, 'Library/Application Support/NSW Fire Coverage');
const lock = JSON.parse(await readFile(join(source, 'dependencies.lock.json'), 'utf8'));
const version = process.env.INSTALLER_VERSION || '1.2.0';
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('INSTALLER_VERSION must be a three-part version.');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

await mkdir(output, { recursive: true });
execFileSync(process.execPath, [join(root, 'Stand-alone/scripts/build.mjs'), '--shared-only'], { cwd: root, stdio: 'inherit' });
await rm(tree, { recursive: true, force: true });
await mkdir(app, { recursive: true });
const shared = join(output, 'shared/payload');
await cp(join(shared, 'app'), join(app, 'app'), { recursive: true });
await cp(join(shared, 'THIRD-PARTY-NOTICES.txt'), join(app, 'THIRD-PARTY-NOTICES.txt'));
await cp(join(shared, 'GIS-WORKSPACE.md'), join(app, 'GIS-WORKSPACE.md'));
await cp(join(shared, 'RSS-FEEDS.md'), join(app, 'RSS-FEEDS.md'));
await cp(join(shared, 'GIS-LARGE-LAYERS.md'), join(app, 'GIS-LARGE-LAYERS.md'));
for (const directory of ['config', 'bin', 'operator']) await cp(join(source, directory), join(app, directory), { recursive: true });
await writeFile(join(app, 'README.md'), (await readFile(join(source, 'README.md'), 'utf8')).replace('](../GIS-WORKSPACE.md)', '](GIS-WORKSPACE.md)'));
await mkdir(join(tree, 'Library/LaunchDaemons'), { recursive: true });
await cp(join(source, 'launchd/au.nswfirecoverage.standalone.plist'), join(tree, 'Library/LaunchDaemons/au.nswfirecoverage.standalone.plist'));
await mkdir(join(tree, 'Applications'), { recursive: true });
await writeFile(join(tree, 'Applications/NSW Fire Coverage.webloc'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>URL</key><string>http://localhost:5400/</string></dict></plist>
`);
const downloads = join(output, 'downloads');
await mkdir(downloads, { recursive: true });
await Promise.all(['x64', 'arm64'].map(async (arch) => {
  const dependency = lock[arch];
  const filename = join(downloads, basename(new URL(dependency.url).pathname));
  let bytes;
  try { bytes = await readFile(filename); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!bytes) {
    const response = await fetch(dependency.url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`Node ${arch} download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(filename, bytes);
  }
  if (sha(bytes) !== dependency.sha256) throw new Error(`Node ${arch} checksum mismatch; do not bypass verification.`);
  const runtime = join(app, `runtime/darwin-${arch}`);
  await mkdir(runtime, { recursive: true });
  execFileSync('python3', ['-c', `
import pathlib,sys,tarfile
archive,out,version,arch=sys.argv[1:]
prefix='node-v'+version+'-darwin-'+arch+'/'
with tarfile.open(archive,'r:xz') as t:
    for src,dst in [('bin/node','node'),('LICENSE','LICENSE')]:
        pathlib.Path(out,dst).write_bytes(t.extractfile(prefix+src).read())
`, filename, runtime, lock.nodeVersion, arch]);
  await chmod(join(runtime, 'node'), 0o755);
}));
await cp(join(app, 'runtime/darwin-x64/LICENSE'), join(app, 'runtime/NODE-LICENSE.txt'));

const runtimeMetadata = [];
for (const arch of ['x64', 'arm64']) {
  const bytes = await readFile(join(app, `runtime/darwin-${arch}/node`));
  if (bytes.readUInt32LE(0) !== 0xfeedfacf) throw new Error(`The ${arch} runtime is not a little-endian 64-bit Mach-O binary.`);
  const expectedCPU = arch === 'x64' ? 0x01000007 : 0x0100000c;
  if (bytes.readUInt32LE(4) !== expectedCPU) throw new Error(`Wrong CPU architecture for ${arch}.`);
  let offset = 32;
  let minimum;
  for (let i = 0; i < bytes.readUInt32LE(16); i += 1) {
    const command = bytes.readUInt32LE(offset);
    if (command === 0x32 || command === 0x24) {
      const value = bytes.readUInt32LE(offset + (command === 0x32 ? 12 : 8));
      minimum = `${value >>> 16}.${(value >>> 8) & 255}.${value & 255}`;
    }
    offset += bytes.readUInt32LE(offset + 4);
  }
  if (!minimum || Number(minimum.split('.')[0]) > 11) throw new Error(`${arch} binary minimum ${minimum} does not match the advertised macOS 11 floor.`);
  runtimeMetadata.push({ architecture: arch, version: lock.nodeVersion, minimumMacOS: minimum, sha256: sha(bytes) });
}
async function files(directory) {
  const list = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) { await chmod(filename, 0o755); list.push(...await files(filename)); }
    else {
      const executable = entry.name === 'node' || entry.name.endsWith('.sh');
      await chmod(filename, executable ? 0o755 : 0o644);
      list.push(filename);
    }
  }
  return list.sort();
}
const records = [];
for (const filename of await files(tree)) {
  const content = await readFile(filename);
  const path = relative(tree, filename).replaceAll('\\', '/');
  if (/\.(mjs|js|css|html|sh|plist|json|webloc)$/.test(path)) {
    if (/https?:\/\/[^"'\s<>]*(?:replit\.(?:com|app|dev)|repl\.co)|\/@vite\/client|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(content.toString('utf8'))) {
      throw new Error(`Unexpected Replit, development, or remote-font URL in ${path}`);
    }
  }
  records.push({ path, bytes: content.length, mode: (await stat(filename)).mode & 0o777, sha256: sha(content) });
}
await writeFile(join(app, 'BUILD-MANIFEST.json'), JSON.stringify({
  version, platform: 'macOS', architectures: ['x86_64', 'arm64'], minimumMacOS: lock.minimumMacOS,
  defaultPort: 5400, builtAt: new Date().toISOString(), runtimes: runtimeMetadata, files: records,
}, null, 2));
await chmod(join(app, 'BUILD-MANIFEST.json'), 0o644);
execFileSync('python3', [join(source, 'scripts/package.py'), tree, source, output, version], { stdio: 'inherit' });
const name = `NSW-Fire-Coverage-${version}-macOS-Intel-AppleSilicon.pkg`;
const digest = sha(await readFile(join(output, name)));
await writeFile(join(output, `${name}.sha256`), `${digest}  ${name}\n`);
const distribution = join(root, 'Stand-alone/dist');
await mkdir(distribution, { recursive: true });
for (const file of [name, `${name}.sha256`]) await cp(join(output, file), join(distribution, file));
process.stdout.write(`PKG created: ${join(output, name)}\nSHA256: ${digest}\n`);
