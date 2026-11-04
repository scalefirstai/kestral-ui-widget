import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, normalizeMnemonic, normalizeError, sanitizeContext, captureErrors, describeContext } from '../src/context.js';

const config = { appId: 'eagle-star', appMnemonic: 'ESR', context: { valuationDate: '2026-11-02' } };
const now = Date.parse('2026-11-04T12:00:00Z');

test('mnemonic: 3 alphanumeric characters, upper-cased', () => {
  assert.equal(normalizeMnemonic('esr'), 'ESR');
  assert.equal(normalizeMnemonic(' T2P '), 'T2P');
  assert.equal(normalizeMnemonic('ESRX'), null);
  assert.equal(normalizeMnemonic('E-R'), null);
  assert.equal(normalizeMnemonic(undefined), null);
});

test('context always carries app mnemonic, app id, screen and error', () => {
  const ctx = buildContext({ config, updates: { screen: 'NAV Dashboard' }, live: { fundId: 'F1' }, now, title: 'Eagle STAR' });
  assert.deepEqual(ctx, { appId: 'eagle-star', appMnemonic: 'ESR', screen: 'NAV Dashboard', error: null, valuationDate: '2026-11-02', fundId: 'F1' });
});

test('screen defaults to the document title', () => {
  assert.equal(buildContext({ config, now, title: 'Pricing - Eagle STAR' }).screen, 'Pricing - Eagle STAR');
});

test('identity keys cannot be overridden by host context', () => {
  const ctx = buildContext({ config, live: { appMnemonic: 'XXX', appId: 'other' }, now });
  assert.equal(ctx.appMnemonic, 'ESR');
  assert.equal(ctx.appId, 'eagle-star');
});

test('error precedence: captured page error < explicit error; stale captured errors are dropped', () => {
  const captured = { code: 'TypeError', message: 'x is undefined', source: 'window.onerror', occurredAt: '2026-11-04T11:55:00Z' };
  assert.equal(buildContext({ config, capturedError: captured, now }).error.code, 'TypeError');
  const explicit = buildContext({ config, capturedError: captured, updates: { error: { code: 'ORA-00060', message: 'deadlock' } }, now });
  assert.equal(explicit.error.code, 'ORA-00060');
  const old = { ...captured, occurredAt: '2026-11-04T10:00:00Z' };
  assert.equal(buildContext({ config, capturedError: old, now }).error, null);
});

test('normalizeError handles Error, strings, event shapes and extra fields', () => {
  const e = normalizeError(new RangeError('bad range'));
  assert.equal(e.code, 'RangeError');
  assert.equal(e.message, 'bad range');
  assert.equal(normalizeError('Job failed').message, 'Job failed');
  assert.equal(normalizeError({ type: 'unhandledrejection', reason: new Error('nope') }).message, 'nope');
  assert.equal(normalizeError({ type: 'error', error: null, message: 'Script error.' }).message, 'Script error.');
  assert.equal(normalizeError({ code: 'ORA-00060', jobName: 'ES_NAV_ACCRUALS' }).jobName, 'ES_NAV_ACCRUALS');
  assert.equal(normalizeError({}), null);
  assert.equal(normalizeError(null), null);
});

test('sanitizeContext drops functions, bounds depth and string length', () => {
  const out = sanitizeContext({ f: () => 1, deep: { a: { b: { c: 1 } } }, long: 'x'.repeat(2000), n: 3 });
  assert.equal(out.f, undefined);
  assert.deepEqual(out.deep, { a: {} });
  assert.equal(out.long.length, 500);
  assert.equal(out.n, 3);
});

test('captureErrors keeps uncaught errors and unhandled rejections; detach stops it', () => {
  const t = new EventTarget();
  const seen = [];
  const stop = captureErrors(t, (e) => seen.push(e));
  const err = new Event('error');
  err.error = new TypeError('boom');
  t.dispatchEvent(err);
  const rej = new Event('unhandledrejection');
  rej.reason = { code: 'HTTP_500', message: 'save failed' };
  t.dispatchEvent(rej);
  stop();
  t.dispatchEvent(err);
  assert.deepEqual(seen.map((e) => [e.code, e.source]), [['TypeError', 'window.onerror'], ['HTTP_500', 'unhandledrejection']]);
});

test('describeContext summarises what is sent', () => {
  assert.equal(describeContext({ appMnemonic: 'ESR', screen: 'NAV Dashboard', error: { code: 'ORA-00060' } }), 'ESR · NAV Dashboard · ⚠ ORA-00060');
});
