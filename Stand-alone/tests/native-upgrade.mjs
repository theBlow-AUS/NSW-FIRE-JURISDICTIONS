#!/usr/bin/env node
// Test runner only: Node 22+ must be installed separately on the disposable host.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import os from 'node:os';
import { assertRetained, assertWorkspace, inventory, seedWorkspace, sha256, writeJson } from './upgrade-support.mjs';

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
assert.ok(args.includes('--disposable-machine'), 'Requires --disposable-machine: installs/uninstalls a system service. Use a clean authorised test host only.');
assert.ok(['win32', 'darwin'].includes(process.platform), 'Native Windows/macOS only; Linux inspection is not native execution.');
const phase = option('--phase');
assert.ok(['fresh-current', 'prepare', 'upgrade', 'verify-boot-uninstall'].includes(phase), 'Specify --phase fresh-current|prepare|upgrade|verify-boot-uninstall');
assert.ok(args.includes('--evidence'), 'Specify an absolute --evidence directory outside the application/state directories.');
const evidence = resolve(option('--evidence'));
const windows = process.platform === 'win32';
const app = windows ? join(process.env.ProgramFiles, 'NSW Fire Coverage') : '/Library/Application Support/NSW Fire Coverage';
const state = windows ? join(process.env.ProgramData, 'NSW Fire Coverage') : '/Library/Application Support/NSW Fire Coverage Data';
assert.ok(![app, state].some((path) => evidence.toLowerCase().startsWith(path.toLowerCase())), 'Evidence must be outside installed directories.');
const checkpoint = join(evidence, 'checkpoint.json');
const configPath = join(state, 'server.json');
const ps = (script) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(`$ErrorActionPreference='Stop'; ${script}`, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 240000 });
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
const command = (bin, argv) => execFileSync(bin, argv, { encoding: 'utf8', timeout: 240000 });
const nativeService = () => windows
  ? JSON.parse(ps("Get-CimInstance Win32_Service -Filter \"Name='NSWFireCoverage'\" | Select-Object State,StartMode,StartName,ProcessId | ConvertTo-Json -Compress"))
  : command('/bin/launchctl', ['print', 'system/au.nswfirecoverage.standalone']);
const stop = () => windows ? ps("Stop-Service NSWFireCoverage") : command('/bin/launchctl', ['bootout', 'system/au.nswfirecoverage.standalone']);
const start = () => windows ? ps("Start-Service NSWFireCoverage") : command('/bin/launchctl', ['bootstrap', 'system', '/Library/LaunchDaemons/au.nswfirecoverage.standalone.plist']);
const bootId = () => windows ? ps('(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString("o")').trim()
  : command('/usr/sbin/sysctl', ['-n', 'kern.boottime']).trim();
async function exists(path) { try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function health(port) {
  let last;
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/healthz`, { signal: AbortSignal.timeout(2000) });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).status, 'ok');
      return;
    } catch (error) { last = error; await new Promise((done) => setTimeout(done, 1000)); }
  }
  throw last;
}
async function install(path, label) {
  assert.ok(await exists(path), `Missing package: ${path}`);
  if (windows) {
    const code = command('msiexec.exe', ['/i', path, '/qn', '/norestart', '/L*v', join(evidence, `${label}-msi.log`)]);
    return code;
  }
  const log = command('/usr/sbin/installer', ['-pkg', path, '-target', '/']);
  await writeFile(join(evidence, `${label}-installer.log`), log);
}
async function uninstall(path) {
  if (windows) command('msiexec.exe', ['/x', path, '/qn', '/norestart', '/L*v', join(evidence, 'uninstall-msi.log')]);
  else command('/bin/sh', [join(app, 'operator/uninstall.sh')]);
}
async function assertRemoved(port) {
  if (windows) assert.equal(ps("if (Get-Service NSWFireCoverage -ErrorAction SilentlyContinue) { 'present' }").trim(), '', 'Service not removed');
  else {
    assert.ok(!(await exists('/Library/LaunchDaemons/au.nswfirecoverage.standalone.plist')));
    assert.throws(() => nativeService(), 'launchd job must be absent');
  }
  assert.ok(!(await exists(join(app, windows ? 'runtime/node.exe' : 'bin/start-server.sh'))), 'Program launcher not removed');
  let serving = false;
  try { const r = await fetch(`http://127.0.0.1:${port}/api/healthz`, { signal: AbortSignal.timeout(2000) }); serving = r.ok; } catch {}
  assert.equal(serving, false, 'HTTP server still running after uninstall');
}
async function smoke(port) {
  await health(port);
  const service = nativeService();
  if (windows) {
    assert.equal(service.State, 'Running'); assert.equal(service.StartMode, 'Auto');
    assert.match(service.StartName, /LocalService/i);
  } else {
    assert.match(service, /state = running/);
    const plist = command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '/Library/LaunchDaemons/au.nswfirecoverage.standalone.plist']);
    const values = JSON.parse(plist);
    assert.equal(values.RunAtLoad, true); assert.equal(values.KeepAlive, true);
    assert.equal(values.UserName, '_nswfirecoverage');
    let arm = false;
    try { arm = command('/usr/sbin/sysctl', ['-n', 'hw.optional.arm64']).trim() === '1'; } catch {}
    const arch = arm ? 'arm64' : 'x64';
    assert.equal(command(join(app, `runtime/darwin-${arch}/node`), ['-p', 'process.arch']).trim(), arch);
  }
  await writeJson(join(evidence, `${phase}-service.json`), service);
  const manifest = JSON.parse(await readFile(join(app, 'BUILD-MANIFEST.json'), 'utf8'));
  await writeJson(join(evidence, `${phase}-installed-manifest.json`), manifest);
  return manifest;
}
await mkdir(evidence, { recursive: true });
let report = { phase, startedAt: new Date().toISOString(), platform: process.platform, architecture: os.arch(), release: os.release(), status: 'failed' };
try {
  if (windows) assert.equal(ps("([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)").trim(), 'True', 'Run elevated');
  else assert.equal(process.getuid(), 0, 'Run using sudo');
  report.os = windows ? ps('Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture | ConvertTo-Json -Compress')
    : command('/usr/bin/sw_vers', []);
  if (phase === 'prepare' || phase === 'fresh-current') {
    assert.ok(!(await exists(app)) && !(await exists(state)), 'Not a clean host. Existing installations/data must never be overwritten by this harness.');
    assert.ok(!(await exists(checkpoint)), 'Evidence directory already belongs to a pilot.');
    if (windows) assert.equal(ps("if (Get-Service NSWFireCoverage -ErrorAction SilentlyContinue) { 'present' }").trim(), '', 'Service already exists');
    else assert.ok(!(await exists('/Library/LaunchDaemons/au.nswfirecoverage.standalone.plist')), 'Service already exists');
    assert.ok(args.includes('--current'), 'Missing --current');
    if (phase === 'fresh-current') {
      const current = resolve(option('--current'));
      report.packageHash = sha256(await readFile(current));
      await install(current, 'fresh-current');
      await smoke(windows ? 8080 : 5400);
      stop();
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      Object.assign(config, { updaterEnabled: false, liveFeedsEnabled: false });
      await writeJson(configPath, config);
      // Service logs legitimately change on start/stop; only durable data and
      // configuration are byte-preservation assertions.
      const data = resolve(state, config.dataDirectory);
      const baseline = await inventory(data);
      const configHash = sha256(await readFile(configPath));
      start(); await smoke(windows ? 8080 : 5400);
      await uninstall(current);
      await assertRemoved(windows ? 8080 : 5400);
      await assertRetained(data, baseline);
      assert.equal(sha256(await readFile(configPath)), configHash);
      report.status = 'passed';
      console.log('Fresh candidate install/uninstall checked. Restore the clean machine snapshot before the upgrade pilot.');
    } else {
    assert.ok(args.includes('--previous'), 'Missing --previous');
    const previous = resolve(option('--previous')), current = resolve(option('--current'));
    const previousHash = sha256(await readFile(previous)), currentHash = sha256(await readFile(current));
    assert.notEqual(previousHash, currentHash, 'Supply two distinct releases');
    const port = Number(args.includes('--port') ? option('--port') : 15400);
    assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535 && ![5400, 8080].includes(port), 'Choose a non-default test port');
    await install(previous, 'fresh-previous');
    const previousManifest = await smoke(windows ? 8080 : 5400);
    stop();
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    Object.assign(config, { host: '127.0.0.1', port, dataDirectory: './pilot-custom-data', updaterEnabled: false, liveFeedsEnabled: false, feedPollingSeconds: { 'incidents-json': 600 } });
    // Overwrite in place to preserve installer-created permissions.
    await writeJson(configPath, config);
    const data = join(state, 'pilot-custom-data');
    await mkdir(data, { recursive: true });
    const fixture = await seedWorkspace(data);
    if (windows) ps(`& icacls.exe ${quote(data)} /grant '*S-1-5-19:(OI)(CI)M' /T /Q; if ($LASTEXITCODE -ne 0) { throw 'icacls failed' }`);
    else command('/usr/sbin/chown', ['-R', '_nswfirecoverage:_nswfirecoverage', data]);
    start(); await smoke(port); stop();
    const retained = await inventory(data);
    await writeJson(checkpoint, { stage: 'prepared', previousVersion: previousManifest.version, previous, current, previousHash, currentHash, port, data, fixture,
      configHash: sha256(await readFile(configPath)), retained, boot: bootId() });
    report.status = 'passed';
    }
  } else {
    const saved = JSON.parse(await readFile(checkpoint, 'utf8'));
    assert.equal(saved.data, join(state, 'pilot-custom-data'), 'Checkpoint belongs to another workspace');
    assert.equal(sha256(await readFile(configPath)), saved.configHash, 'Configuration changed');
    await assertRetained(saved.data, saved.retained);
    if (phase === 'upgrade') {
      assert.equal(saved.stage, 'prepared');
      assert.equal(sha256(await readFile(saved.current)), saved.currentHash, 'Candidate package changed');
      await install(saved.current, 'upgrade-current');
      const candidate = await smoke(saved.port);
      assert.match(candidate.version, /^\d+\.\d+\.\d+$/);
      assert.match(saved.previousVersion, /^\d+\.\d+\.\d+$/);
      const currentParts = candidate.version.split('.').map(Number);
      const previousParts = saved.previousVersion.split('.').map(Number);
      const differing = currentParts.findIndex((part, i) => part !== previousParts[i]);
      assert.ok(differing >= 0 && currentParts[differing] > previousParts[differing], 'Candidate must be a newer installed release');
      await assertWorkspace(`http://127.0.0.1:${saved.port}`, saved.fixture);
      await assertRetained(saved.data, saved.retained);
      assert.equal(sha256(await readFile(configPath)), saved.configHash);
      // Include any SQLite index generated by the candidate in the reboot and
      // uninstall baseline, after closing it cleanly (older GIS has no index).
      stop();
      const retained = await inventory(saved.data);
      start(); await smoke(saved.port);
      await writeJson(checkpoint, { ...saved, retained, stage: 'awaiting-reboot', boot: bootId() });
      report.status = 'passed-awaiting-reboot';
    } else {
      assert.equal(saved.stage, 'awaiting-reboot');
      assert.notEqual(bootId(), saved.boot, 'Reboot required. Do not manually start the service after boot.');
      await smoke(saved.port);
      await assertRetained(saved.data, saved.retained);
      await assertWorkspace(`http://127.0.0.1:${saved.port}`, saved.fixture);
      await uninstall(saved.current);
      await assertRemoved(saved.port);
      await assertRetained(saved.data, saved.retained);
      assert.equal(sha256(await readFile(configPath)), saved.configHash);
      await writeJson(checkpoint, { ...saved, stage: 'complete' });
      report.status = 'passed';
    }
  }
} catch (error) {
  report.error = error.stack;
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeJson(join(evidence, `${phase}-result.json`), report);
  console.log(JSON.stringify(report, null, 2));
}
