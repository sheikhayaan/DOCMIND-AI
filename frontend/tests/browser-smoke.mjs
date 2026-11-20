// Optional real-browser smoke test. Requires Node 22+ and a local Chrome installation; installs nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'docmind-admin-smoke-'));
const children = [];
const exceptions = [];
let socket;
let mobile = false;

// Reserves an unused local port without relying on a developer's running services.
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

// Starts an owned test process with logs isolated from the project's live data.
function start(command, args, cwd, env, label) {
  const fd = fs.openSync(path.join(artifacts, `${label}.log`), 'a');
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', fd, fd], windowsHide: true });
  fs.closeSync(fd);
  children.push(child);
  return child;
}

// Waits for local services and browser-visible states with a bounded timeout.
async function waitFor(check, label, timeout = 90_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try { if (await check()) return; } catch { /* Startup and navigation races are retried within the deadline. */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label}. Logs: ${artifacts}`);
}

const pending = new Map();
let sequence = 0;

// Issues a Chrome DevTools Protocol command with no third-party browser automation library.
function cdp(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, method === 'Page.navigate' ? 120_000 : 30_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

// Evaluates a trusted test expression and returns only its JSON-serializable result.
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed');
  return result.result.value;
}

// Sends an actual mouse click or touch tap so gesture-gated controls receive browser activation.
async function click(selector) {
  await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.disabled) throw new Error('Control missing or disabled'); el.scrollIntoView({block:'center', inline:'center', behavior:'instant'}); })()`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const box = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const r = el.getBoundingClientRect(); const x=r.x+r.width/2, y=r.y+r.height/2; const hit=document.elementFromPoint(x,y); if (!hit || !el.contains(hit)) throw new Error('Control is obscured: '+JSON.stringify({tag:hit?.tagName,classes:hit?.className,text:hit?.textContent?.slice(0,140),button:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight}})); return {x,y}; })()`);
  if (mobile) {
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...box, radiusX: 2, radiusY: 2 }] });
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...box });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...box });
  }
}

// Identifies an enabled button by visible text without selecting hidden tab-panel content.
async function clickText(text) {
  await evaluate(`(() => { const el = [...document.querySelectorAll('button')].find(el => el.textContent.includes(${JSON.stringify(text)}) && !el.disabled); if (!el) throw new Error('Button not found'); el.dataset.smokeTarget='true'; })()`);
  await click('[data-smoke-target="true"]');
  await evaluate(`document.querySelector('[data-smoke-target="true"]')?.removeAttribute('data-smoke-target')`);
}

// Enters text through Chrome's input subsystem so React sees normal input events.
async function fill(selector, text) {
  await evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select(); })()`);
  await cdp('Input.insertText', { text });
}

// Captures a real viewport screenshot for desktop/mobile visual verification.
async function screenshot(name) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(artifacts, name), Buffer.from(data, 'base64'));
}

try {
  assert.ok(typeof WebSocket === 'function', 'Run browser smoke tests with Node 22 or newer.');
  const backendPort = await freePort();
  const frontendPort = await freePort();
  const chromePort = await freePort();
  const backend = `http://127.0.0.1:${backendPort}`;
  const frontend = `http://127.0.0.1:${frontendPort}`;
  const token = randomBytes(24).toString('hex');
  const python = process.env.PYTHON_BIN || (process.platform === 'win32' ? path.join(root, 'backend/venv/Scripts/python.exe') : path.join(root, '.venv/bin/python'));
  const chrome = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome');
  assert.ok(fs.existsSync(python), 'Set PYTHON_BIN to the existing backend Python executable.');
  assert.ok(fs.existsSync(chrome), 'Set CHROME_PATH to an installed Chrome executable.');
  start(python, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(backendPort)], path.join(root, 'backend'), {
    TESTING: 'true', ENVIRONMENT: 'development', QUEUE_BACKEND: 'inline', FRONTEND_URL: frontend,
    DOCMIND_DATA_DIR: artifacts, SECURITY_DB_PATH: path.join(artifacts, 'security.sqlite3'), JOBS_DB_PATH: path.join(artifacts, 'jobs.sqlite3'), SESSIONS_DB_PATH: path.join(artifacts, 'sessions.sqlite3'),
    AUTH_SECRET: randomBytes(32).toString('hex'), ADMIN_EMAIL: 'operator@example.test', ADMIN_ACCESS_TOKEN: token,
    GROQ_API_KEY: '', PINECONE_API_KEY: '', RECAPTCHA_SECRET_KEY: '', GOOGLE_CLIENT_ID: '',
  }, 'backend');
  start(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--port', String(frontendPort), '--hostname', '127.0.0.1'], path.join(root, 'frontend'), {
    NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_API_URL: backend, API_INTERNAL_URL: backend,
    NEXT_PUBLIC_ADMIN_EMAIL: 'operator@example.test', NEXT_PUBLIC_RECAPTCHA_SITE_KEY: '', NEXT_PUBLIC_GOOGLE_CLIENT_ID: '',
  }, 'frontend');
  await waitFor(async () => (await fetch(`${backend}/health`)).ok, 'FastAPI startup');
  await waitFor(async () => (await fetch(`${frontend}/admin`)).ok, 'Next.js admin route', 120_000);
  start(chrome, ['--headless=new', `--remote-debugging-port=${chromePort}`, `--user-data-dir=${path.join(artifacts, 'chrome')}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-default-apps', '--disable-sync', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,1000', 'about:blank'], root, {}, 'chrome');
  const debuggerUrl = `http://127.0.0.1:${chromePort}`;
  let tab;
  await waitFor(async () => { const tabs = await (await fetch(`${debuggerUrl}/json/list`)).json(); tab = tabs.find((entry) => entry.type === 'page'); return Boolean(tab); }, 'headless Chrome');
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const call = pending.get(message.id); pending.delete(message.id); clearTimeout(call.timer);
      if (message.error) call.reject(new Error(message.error.message)); else call.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
  });
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__speechCount = 0;
    Object.defineProperty(window, 'speechSynthesis', { configurable:true, value:{
      speak(utterance) { window.__speechCount++; window.__speechPinned=window._activeUtterance===utterance; window.__speechGesture=navigator.userActivation.isActive; },
      cancel() {}, getVoices() { return []; }
    }});
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text=text; } };
    window.SpeechRecognition = class { start() { queueMicrotask(() => this.onerror?.({error:'not-allowed'})); } stop() { this.onend?.(); } abort() {} };
  ` });
  await cdp('Page.navigate', { url: `${frontend}/admin` });
  await waitFor(() => evaluate(`document.body.textContent.includes('Authorized operators only')`), 'interactive admin sign-in');
  await fill('input[type="password"]', token);
  await waitFor(() => evaluate(`!document.querySelector('button[type="submit"]').disabled`), 'enabled login submit');
  await click('button[type="submit"]');
  await waitFor(() => evaluate(`!!document.querySelector('[role="tablist"]')`), 'authorized command center');
  assert.ok(await evaluate(`document.body.textContent.includes('0.0') && document.body.textContent.includes('0 verified reviews')`));
  await new Promise((resolve) => setTimeout(resolve, 6000));
  await screenshot('admin-desktop.png');
  console.log('Browser: real admin sign-in and desktop telemetry passed.');
  await click('#tab-users');
  await waitFor(() => evaluate(`document.querySelector('table')?.textContent.includes('Not rated yet')`), 'real unrated roster');
  await click('table button');
  await waitFor(() => evaluate(`document.querySelector('dialog[open]')?.textContent.includes('Recent document sessions')`), 'account inspection');
  assert.ok(!await evaluate(`document.querySelector('dialog').textContent.includes('password_hash')`));
  await click('button[aria-label="Close dialog"]');
  await click('#tab-overview');
  await clickText('Run Autonomous Diagnostics');
  await waitFor(() => evaluate(`document.body.textContent.includes('Latest diagnostics result')`), 'real diagnostics report');
  assert.ok(await evaluate(`document.body.textContent.includes('Nominal health is not verified')`));
  assert.equal((await fetch(`${backend}/api/admin/overview`)).status, 401);
  await click('#tab-incidents');
  await waitFor(() => evaluate(`document.body.textContent.includes('Diagnostics only; no remedy was applicable.')`), 'durable healing audit');
  await waitFor(() => evaluate(`document.body.textContent.includes('AUTH_ANOMALY')`), 'real unauthorized-request incident');
  await clickText('Resolve manually');
  await waitFor(() => evaluate(`!!document.querySelector('dialog[open] textarea')`), 'incident resolution dialog');
  await fill('dialog textarea', 'Verified this was the isolated browser smoke test request.');
  await clickText('Confirm manual resolution');
  await waitFor(() => evaluate(`document.body.textContent.includes('Manually resolved')`), 'manual resolution audit');
  await click('#tab-portfolio');
  await waitFor(() => evaluate(`document.body.textContent.includes('Engineering interview rehearsal')`), 'portfolio tab');
  assert.equal(await evaluate('window.__speechCount'), 0);
  await clickText('Listen / Read Aloud');
  assert.equal(await evaluate('window.__speechCount'), 1);
  assert.equal(await evaluate('window.__speechPinned && window.__speechGesture'), true);
  assert.ok(await evaluate(`window._activeUtterance.text.split(' ').length <= 12`));
  await clickText('Next / Skip');
  await waitFor(() => evaluate(`document.body.textContent.includes('Why preserve active jobs')`), 'forward stepping');
  assert.equal(await evaluate('window._activeUtterance'), null);
  for (let step = 0; step < 3; step += 1) await clickText('Next / Skip');
  await waitFor(() => evaluate(`document.body.textContent.includes('Rehearsal complete')`), 'all questions skippable');
  console.log('Browser: roster, diagnostics, audit, pinned gesture-only speech, and interview stepping passed.');

  mobile = true;
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true });
  await click('#tab-overview');
  await evaluate('window.scrollTo(0,0)');
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'Mobile admin layout must not overflow the viewport');
  await screenshot('admin-mobile.png');
  await click('#tab-users');
  await waitFor(() => evaluate(`!!document.querySelector('table button')`), 'mobile roster');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'Mobile table must scroll inside its container');

  await cdp('Page.navigate', { url: `${frontend}/chat?docId=ui-test-document&filename=Notes.pdf` });
  await waitFor(() => evaluate(`!!document.querySelector('textarea[aria-label="Your document question"]')`), 'mobile chat');
  await click('button[title="Dictate question with voice"]');
  await waitFor(() => evaluate(`document.body.textContent.includes('Microphone unavailable')`), 'microphone failure escape');
  await clickText('Next / Skip');
  assert.ok(await evaluate(`document.body.textContent.includes('Turn 2')`));
  await evaluate(`window.__queries=[]; window.__originalFetch=window.fetch.bind(window); window.fetch=(input,init)=>String(input).endsWith('/query') ? new Promise(resolve=>window.__queries.push(resolve)) : window.__originalFetch(input,init)`);
  await fill('textarea[aria-label="Your document question"]', 'First question');
  await click('button[aria-label="Submit question"]');
  await waitFor(() => evaluate('window.__queries.length === 1'), 'pending query');
  await clickText('Next / Skip');
  await fill('textarea[aria-label="Your document question"]', 'Second question');
  await click('button[aria-label="Submit question"]');
  await waitFor(() => evaluate('window.__queries.length === 2'), 'next query despite pending work');
  await evaluate(`window.__queries[1](new Response(JSON.stringify({success:true,answer:'LATEST_REPLY_MARKER',sources:[],doc_ids:['ui-test-document'],confidence:'high',confidence_score:0.9}),{status:200,headers:{'Content-Type':'application/json'}}))`);
  await waitFor(() => evaluate(`document.body.textContent.includes('LATEST_REPLY_MARKER')`), 'current answer');
  await evaluate(`window.__queries[0](new Response(JSON.stringify({success:true,answer:'STALE_REPLY_MARKER',sources:[],doc_ids:['ui-test-document'],confidence:'high',confidence_score:0.9}),{status:200,headers:{'Content-Type':'application/json'}}))`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.ok(!await evaluate(`document.body.textContent.includes('STALE_REPLY_MARKER')`), 'A skipped turn must never overwrite the current answer');
  assert.equal(await evaluate('window.__speechCount'), 0);
  await clickText('Listen / Read Aloud');
  assert.equal(await evaluate('window.__speechPinned && window.__speechGesture'), true);
  assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'));
  await screenshot('chat-mobile.png');
  assert.deepEqual(exceptions, []);
  console.log(`PASS: desktop/mobile tabs, real auth, nullable ratings, user inspection, diagnostics/audit, tap-only pinned speech, microphone failure, forward skipping, and stale-response cancellation.\nScreenshots and logs: ${artifacts}`);
} catch (error) {
  console.error(error);
  if (socket?.readyState === 1) { try { await screenshot('failure.png'); } catch { /* A closed page has no screenshot. */ } }
  console.error(`Artifacts: ${artifacts}`);
  process.exitCode = 1;
} finally {
  if (socket?.readyState === 1) { try { await cdp('Browser.close'); } catch { /* The browser may close before acknowledging. */ } socket.close(); }
  for (const child of children.reverse()) {
    if (child.pid && child.exitCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      else child.kill('SIGTERM');
    }
  }
}
