import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContext, resolveMnemonic, describeContext } from '../src/context.js';

test('normalizeContext: identity from the caller, standard keys, custom keys grouped, bounded', () => {
  const c = normalizeContext(
    { appMnemonic: 'XXX', screen: 'Pricing', route: '/pricing', error: { code: 'PRICED_STALE', message: 'm', extra: { x: 1 } }, fundId: 'F1', fn: 'y'.repeat(900) },
    { appId: 'eagle-star', appMnemonic: 'ESR' },
  );
  assert.equal(c.appMnemonic, 'ESR');
  assert.equal(c.screen, 'Pricing');
  assert.equal(c.route, '/pricing');
  assert.deepEqual(c.error, { code: 'PRICED_STALE', message: 'm' });
  assert.equal(c.custom.fundId, 'F1');
  assert.equal(c.custom.fn.length, 500);
});

test('normalizeContext: missing pieces become explicit nulls', () => {
  assert.deepEqual(normalizeContext(undefined, { appId: 'a', appMnemonic: null }), { appMnemonic: null, appId: 'a', screen: null, error: null });
  assert.deepEqual(normalizeContext({ error: 'Timeout' }, { appId: 'a', appMnemonic: 'AAA' }).error, { message: 'Timeout' });
});

test('resolveMnemonic prefers the registry and rejects mismatches', () => {
  assert.deepEqual(resolveMnemonic({ appMnemonic: 'esr' }, { mnemonic: 'ESR' }), { mnemonic: 'ESR' });
  assert.deepEqual(resolveMnemonic({}, { mnemonic: 'ESR' }), { mnemonic: 'ESR' });
  assert.deepEqual(resolveMnemonic({ appMnemonic: 'ABC' }, null), { mnemonic: 'ABC' });
  assert.ok(resolveMnemonic({ appId: 'eagle-star', appMnemonic: 'TAP' }, { mnemonic: 'ESR' }).error);
});

test('describeContext', () => {
  const text = describeContext({ appMnemonic: 'ESR', appId: 'eagle-star', screen: 'NAV', error: { code: 'E1', message: 'boom', jobName: 'J' }, custom: { fundId: 'F1' } });
  assert.equal(text, 'Application: ESR (eagle-star)\nScreen: NAV\nError on screen: E1 - boom (job J)\nOther: {"fundId":"F1"}');
});
