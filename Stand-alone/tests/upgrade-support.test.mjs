import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import { inventory, assertRetained, assertWorkspace, seedWorkspace, writeJson } from './upgrade-support.mjs';

test('preservation inventory detects edits/deletions and rejects symlinks', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'upgrade-inventory-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await seedWorkspace(root);
  const before = await inventory(root);
  assert.ok(Object.keys(before).some((p) => p.includes('/Sources/')));
  assert.ok(Object.keys(before).some((p) => p.includes('/Working/')));
  assert.ok(Object.keys(before).some((p) => p.includes('/Exports/')));
  await assertRetained(root, before);
  const name = Object.keys(before)[0], original = await readFile(join(root, name));
  await writeFile(join(root, name), 'changed');
  await assert.rejects(assertRetained(root, before), /Changed or missing/);
  await writeFile(join(root, name), original);
  await rm(join(root, name));
  await assert.rejects(assertRetained(root, before), /ENOENT/);
  await symlink(tmpdir(), join(root, 'outside'));
  await assert.rejects(inventory(root), /Refusing linked/);
});

test('native runner refuses Linux before any installation', { skip: process.platform !== 'linux' }, () => {
  assert.throws(() => execFileSync(process.execPath, ['Stand-alone/tests/native-upgrade.mjs',
    '--disposable-machine', '--phase', 'prepare', '--evidence', '/tmp/not-used-native-evidence'], { stdio: 'pipe' }),
  (error) => /Native Windows\/macOS only/.test(error.stderr.toString()));
});

test('upgrade fixture is readable by the actual packaged GIS/feed runtime across restart', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'upgrade-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = join(root, 'custom-data');
  const fixture = await seedWorkspace(data);
  const expected = await inventory(data);
  const socket = net.createServer();
  await new Promise((done) => socket.listen(0, '127.0.0.1', done));
  const port = socket.address().port;
  await new Promise((done) => socket.close(done));
  await writeJson(join(root, 'server.json'), { host: '127.0.0.1', port, dataDirectory: './custom-data', updaterEnabled: false, liveFeedsEnabled: false });
  const serverPath = 'generated-artifacts/standalone/payload/app/server.mjs';
  for (let round = 0; round < 2; round++) {
    const child = spawn(process.execPath, [serverPath, '--config', join(root, 'server.json')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const exited = new Promise((done) => child.once('exit', done));
    try {
      let ready = false;
      for (let n = 0; n < 100; n++) {
        if (child.exitCode !== null) throw new Error(output);
        try { ready = (await fetch(`http://127.0.0.1:${port}/api/healthz`)).ok; } catch {}
        if (ready) break;
        await new Promise((done) => setTimeout(done, 100));
      }
      assert.ok(ready, output);
      await assertWorkspace(`http://127.0.0.1:${port}`, fixture);
      await assertRetained(data, expected);
    } finally {
      child.kill('SIGTERM');
      await exited;
    }
  }
});
