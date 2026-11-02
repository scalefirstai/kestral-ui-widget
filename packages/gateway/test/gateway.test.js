import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';

const apps = new Map([['eagle-star', { name: 'Eagle STAR', namespaces: ['fund-accounting/eagle-star', 'shared'] }]]);
const cfg = { ...loadConfig({ ELIZA_MODE: 'mock', AUTH_MODE: 'bearer', ALLOWED_ORIGINS: 'https://app.example' }), apps, rateLimitPerMin: 1000 };
const logs = [];
let server;
let base;

before(async () => {
  server = createServer(cfg, { log: (l) => logs.push(l) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const tok = 'h.' + Buffer.from(JSON.stringify({ sub: 'u123' })).toString('base64url') + '.s';
const post = (path, body, headers = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}`, ...headers }, body: JSON.stringify(body) });

test('health', async () => {
  const r = await fetch(`${base}/health`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).eliza, 'mock');
});

test('streams SSE tokens, citations and done', async () => {
  const r = await post('/v1/chat', { appId: 'eagle-star', namespace: 'fund-accounting/eagle-star', message: 'NAV job failed', conversationId: 'c1' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/event-stream/);
  const text = await r.text();
  assert.match(text, /event: token/);
  assert.match(text, /event: citation/);
  assert.match(text, /event: done/);
  const log = logs.find((l) => l.event === 'chat');
  assert.equal(log.user, 'u123');
  assert.equal(log.question, undefined, 'question text must not be logged by default');
});

test('JSON mode', async () => {
  const r = await post('/v1/chat?stream=false', { appId: 'eagle-star', message: 'hi' });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.match(j.text, /Mock answer/);
  assert.equal(j.citations.length, 2);
});

test('rejects missing token', async () => {
  const r = await fetch(`${base}/v1/chat`, { method: 'POST', body: JSON.stringify({ appId: 'eagle-star', message: 'x' }) });
  assert.equal(r.status, 401);
});

test('rejects unregistered app and foreign namespace', async () => {
  assert.equal((await post('/v1/chat', { appId: 'other', message: 'x' })).status, 403);
  assert.equal((await post('/v1/chat', { appId: 'eagle-star', namespace: 'transfer-agency/x', message: 'x' })).status, 403);
});

test('validates input', async () => {
  assert.equal((await post('/v1/chat', { appId: 'eagle-star', message: '' })).status, 400);
  assert.equal((await post('/v1/chat', { appId: 'eagle-star', message: 'x'.repeat(4001) })).status, 400);
});

test('CORS allowlist', async () => {
  const ok = await fetch(`${base}/v1/chat`, { method: 'OPTIONS', headers: { Origin: 'https://app.example' } });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.example');
  const bad = await fetch(`${base}/v1/chat`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
  assert.equal(bad.status, 403);
});

test('feedback accepted', async () => {
  const r = await post('/v1/feedback', { appId: 'eagle-star', messageId: 'm1', rating: 'up' });
  assert.equal(r.status, 202);
});

test('trusted-header auth for IIS / Windows-auth fronted ASP.NET apps', async () => {
  const s2 = createServer({ ...cfg, authMode: 'trusted-header' }, { log: () => {} });
  await new Promise((r) => s2.listen(0, '127.0.0.1', r));
  const u = `http://127.0.0.1:${s2.address().port}/v1/chat?stream=false`;
  const body = JSON.stringify({ appId: 'eagle-star', message: 'x' });
  assert.equal((await fetch(u, { method: 'POST', body })).status, 401);
  assert.equal((await fetch(u, { method: 'POST', body, headers: { 'X-Forwarded-User': 'CORP\\jdoe' } })).status, 200);
  s2.close();
});
