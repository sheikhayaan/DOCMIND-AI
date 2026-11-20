import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTypeScript } from './load-typescript.mjs';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

// Restores browser doubles so credential tests cannot influence other cases.
afterEach(() => { globalThis.fetch = originalFetch; if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; });

// Supplies a deterministic token store without persisting a test credential on disk.
function browser(token = 'signed-test-token') {
  const values = new Map(token ? [['token', token]] : []);
  globalThis.window = {
    localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) },
    dispatchEvent: () => true,
  };
  return values;
}

// Creates a real Fetch Response containing the application's JSON envelope.
function response(data, status = 200) {
  return new Response(JSON.stringify({ success: status < 400, data: status < 400 ? data : null, error: status < 400 ? null : 'denied' }), { status, headers: { 'Content-Type': 'application/json' } });
}

test('unrated records never receive a fabricated 5.0 default', () => {
  const { rating, measurement } = loadTypeScript('components/admin/shared.tsx');
  assert.equal(rating(null, 0), 'Not rated yet');
  assert.equal(rating(5, 0), 'Not rated yet');
  assert.equal(rating(0, 1), '0.0 / 5');
  assert.equal(rating(3.5, 2), '3.5 / 5');
  assert.equal(measurement(null), 'N/A');
  assert.equal(measurement(Number.NaN), 'N/A');
});

test('every protected native JSON request includes bearer, content type, and cross-domain credentials', async () => {
  browser();
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return response({ ok: true }); };
  const api = loadTypeScript('lib/admin-api.ts');
  await api.getAdminTelemetry();
  await api.getNodeTelemetry();
  await api.executeSelfHealing('incident-1');
  await api.finishSession('session-1', null);
  await api.finishSession('session-1', 4);
  for (const { init } of calls) {
    assert.equal(init.credentials, 'include');
    assert.equal(init.headers.Authorization, 'Bearer signed-test-token');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(init.cache, 'no-store');
    assert.ok(init.signal instanceof AbortSignal);
  }
  assert.deepEqual(JSON.parse(calls[3].init.body), {});
  assert.deepEqual(JSON.parse(calls[4].init.body), { stars: 4 });
});

test('admin calls fail closed without a token and never mint anonymous replacement sessions', async () => {
  browser(null);
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return response({}); };
  const api = loadTypeScript('lib/admin-api.ts');
  await assert.rejects(api.getAdminOverview(), (error) => error.status === 401);
  assert.equal(calls, 0);
});

test('rejected admin mutations are not retried or silently downgraded', async () => {
  const values = browser();
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return response(null, 403); };
  const api = loadTypeScript('lib/admin-api.ts');
  await assert.rejects(api.executeSelfHealing(), (error) => error.status === 403);
  assert.equal(calls, 1);
  assert.equal(values.get('token'), 'signed-test-token');
});

test('chat fetches carry authentication and bound string history', async () => {
  browser();
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return response({ answer: 'A reply' }); };
  const api = loadTypeScript('lib/api.ts', { './recaptcha': { getRecaptchaToken: async () => null } });
  await api.queryDocument('Question', 'doc', undefined, [{ role: 'assistant', content: 'x'.repeat(6000) }]);
  const request = calls[0].init;
  assert.equal(request.credentials, 'include');
  assert.equal(new Headers(request.headers).get('Authorization'), 'Bearer signed-test-token');
  assert.equal(new Headers(request.headers).get('Content-Type'), 'application/json');
  assert.equal(JSON.parse(request.body).history[0].content.length, 4000);
});

test('Next / Skip cancellation prevents a stale query fetch from being replayed', async () => {
  browser();
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('network'); };
  const api = loadTypeScript('lib/api.ts', { './recaptcha': { getRecaptchaToken: async () => null } });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(api.queryDocument('Question', 'doc', undefined, [], undefined, controller.signal), (error) => error.name === 'AbortError');
  assert.equal(calls, 0);
  await assert.rejects(api.queryDocument('Question', 'doc'));
  assert.equal(calls, 1);
});

test('prompt guards handle nulls, hostile shapes, and long grading rubrics', () => {
  const { safeText, splitPrompt, spokenPreview } = loadTypeScript('lib/text-safety.ts');
  for (const value of [null, undefined, {}, [], 5]) {
    assert.equal(safeText(value), '');
    assert.deepEqual(splitPrompt(value), { core: '', rubric: '' });
    assert.equal(spokenPreview(value), '');
  }
  const prompt = 'How does your gateway recover when an upstream model times out?\n## Grading rubric:\n' + 'Verbose criteria. '.repeat(1000);
  const parts = splitPrompt(prompt);
  assert.equal(parts.core, 'How does your gateway recover when an upstream model times out?');
  assert.ok(parts.rubric.includes('Verbose criteria'));
  assert.ok(spokenPreview(prompt).split(' ').length <= 12);
  assert.ok(!spokenPreview(prompt).includes('rubric'));
  assert.equal(safeText('a\u0000b'), 'ab');
  assert.ok(spokenPreview('x'.repeat(10_000)).length <= 120);
});

test('forward stepping never depends on a submitted answer and terminates cleanly', () => {
  const { advanceStep } = loadTypeScript('lib/text-safety.ts');
  let step = 0;
  for (let index = 0; index < 4; index += 1) step = advanceStep(step, 4);
  assert.equal(step, 4);
  assert.equal(advanceStep(step, 4), 4);
  assert.equal(advanceStep(Number.NaN, 4), 1);
  assert.equal(advanceStep(-5, 4), 1);
});

test('audio UI is manual and does not speak during rendering', () => {
  browser();
  let calls = 0;
  window.speechSynthesis = { speak: () => { calls += 1; } };
  const { default: Button } = loadTypeScript('components/read-aloud-button.tsx');
  const html = renderToStaticMarkup(createElement(Button, { text: 'A short response.' }));
  assert.match(html, /Listen \/ Read Aloud/);
  assert.match(html, /type="button"/);
  assert.equal(calls, 0);
});

test('rating UI has no preselected star and offers an explicit skip', () => {
  const { default: Rating } = loadTypeScript('components/session-rating.tsx');
  const html = renderToStaticMarkup(createElement(Rating, { sessionId: 'test-session', onCompleted: () => {} }));
  assert.match(html, /Not rated yet/);
  assert.match(html, /Finish \/ Skip rating/);
  assert.equal((html.match(/aria-pressed="false"/g) || []).length, 5);
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 0);
});

test('Node runtime measurements come from the real process and remain JSON finite', () => {
  const { getRuntimeSnapshot } = loadTypeScript('lib/server/runtime-telemetry.ts');
  const snapshot = getRuntimeSnapshot();
  assert.equal(snapshot.processId, process.pid);
  assert.ok(snapshot.rssBytes > 0 && snapshot.heapUsedBytes > 0);
  assert.ok(snapshot.heapTotalBytes >= snapshot.heapUsedBytes);
  assert.ok(snapshot.cpuPercent === null || Number.isFinite(snapshot.cpuPercent));
  assert.ok(snapshot.eventLoopLagMs === null || Number.isFinite(snapshot.eventLoopLagMs));
});

test('a delayed guest-session response cannot replace a completed admin login', async () => {
  const values = browser(null);
  let release;
  globalThis.fetch = () => new Promise((resolve) => { release = resolve; });
  const api = loadTypeScript('lib/api.ts', { './recaptcha': { getRecaptchaToken: async () => null } });
  const pending = api.ensureAccessToken();
  values.set('token', 'new-admin-session');
  release(response({ access_token: 'late-guest-session' }));
  assert.equal(await pending, 'new-admin-session');
  assert.equal(values.get('token'), 'new-admin-session');
});

test('a provider 401 cannot erase an anonymous user and its document ownership', async () => {
  const body = Buffer.from(JSON.stringify({ role: 'user', email: null, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const token = `${body}.test-signature`;
  const values = browser(token);
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return response(null, 401); };
  const api = loadTypeScript('lib/api.ts', { './recaptcha': { getRecaptchaToken: async () => null } });
  await assert.rejects(api.queryDocument('Question', 'owned-document'));
  assert.equal(calls, 1);
  assert.equal(values.get('token'), token);
});
