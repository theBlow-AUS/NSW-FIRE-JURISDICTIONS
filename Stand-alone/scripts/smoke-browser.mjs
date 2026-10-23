// Build-machine verification only; Chromium is not bundled or needed on the target server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const payload = resolve(process.env.STANDALONE_PAYLOAD || 'generated-artifacts/standalone/payload');
const { createCache } = await import(pathToFileURL(join(payload, 'app/cache.mjs')));
const { createApplication } = await import(pathToFileURL(join(payload, 'app/server.mjs')));
const temporary = await mkdtemp(join(tmpdir(), 'nsw-selfhost-browser-'));
const cache = createCache({ dataDirectory: join(temporary, 'data'), updaterEnabled: false });
await cache.initialise();
const server = createApplication({ publicDirectory: join(payload, 'app/public'), cache });
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const browser = spawn(process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium', [
  '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  '--remote-debugging-port=0', `--user-data-dir=${join(temporary, 'browser')}`, 'about:blank',
], { stdio: 'ignore' });
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
let ws;
try {
  let port;
  for (let i = 0; i < 80; i += 1) {
    try { port = (await readFile(join(temporary, 'browser/DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await pause(100); }
  }
  if (!port) throw new Error('Chromium did not start.');
  const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((entry) => entry.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, reject) => { ws.addEventListener('open', done, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  const pending = new Map(), requests = [], failures = [], errors = [];
  let id = 0;
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data));
    if (message.id) {
      const callback = pending.get(message.id);
      pending.delete(message.id);
      message.error ? callback.reject(message.error) : callback.resolve(message.result);
    }
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    if (message.method === 'Network.loadingFailed' && message.params.blockedReason === 'csp') failures.push(message.params);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id; pending.set(next, { resolve, reject }); ws.send(JSON.stringify({ id: next, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async (condition) => {
    for (let i = 0; i < 200; i += 1) { if (await evaluate(condition)) return; await pause(250); }
    throw new Error(`Timed out: ${condition}\n${await evaluate('document.body.innerText')}`);
  };
  await send('Network.enable');
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await wait(`!!document.querySelector('[data-testid="details-coordinates"]')`);
  await evaluate(`(() => {
    document.querySelector('[data-testid="details-coordinates"]').open=true;
    const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    for(const [name,value] of [['input-latitude','-33.8688'],['input-longitude','151.2093']]){
      const input=document.querySelector('[data-testid="'+name+'"]');set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));
    }
  })()`);
  await pause(100);
  await evaluate(`document.querySelector('[data-testid="form-coordinates"]').requestSubmit()`);
  await wait(`!!document.querySelector('[data-testid="status-rfs-frnsw"]')`);
  await wait(`document.querySelectorAll('[data-testid^="card-frnsw-station-"]').length===3`);
  assert.match(await evaluate(`document.querySelector('[data-testid="text-frnsw-permit"]').textContent`), /all year/);
  assert.equal(await evaluate(`document.querySelector('[data-testid="card-rfs-contact-0"]')===null`), true);
  assert.ok(requests.some((url) => url.includes('/api/fire-context')));
  assert.ok(requests.some((url) => url.includes('/FeatureServer/0/query')));
  const allowed = new Set(['127.0.0.1', 'maps.six.nsw.gov.au', 'mapsq.six.nsw.gov.au', 'portal.data.nsw.gov.au']);
  assert.deepEqual(requests.filter((url) => /^https?:/.test(url) && !allowed.has(new URL(url).hostname)), []);
  assert.deepEqual(failures, []);
  assert.deepEqual(errors, []);
  await evaluate(`document.querySelector('[data-testid="panel-rfs"]').scrollIntoView({block:'start'})`);
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(process.env.STANDALONE_SCREENSHOT || 'generated-artifacts/standalone/standalone-stations.png', Buffer.from(screenshot.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'));
  process.stdout.write('PASS: real standalone browser, local API, live NSW boundary/GURAS/station calls, year-round FRNSW permit result, three nearby stations, mobile width, no Replit/font requests or CSP/runtime errors.\n');
} finally {
  ws?.close();
  browser.kill();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  await pause(200);
  await rm(temporary, { recursive: true, force: true });
}
