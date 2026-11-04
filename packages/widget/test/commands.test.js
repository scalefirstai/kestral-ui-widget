import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCommandApi } from '../src/commands.js';

function fakeInit() {
  const log = [];
  const init = (cfg) => {
    log.push(['init', cfg.appId]);
    const api = {};
    for (const m of ['open', 'close', 'reset', 'ask', 'update', 'setError', 'destroy']) api[m] = (a) => log.push([m, a]);
    return api;
  };
  return { init, log };
}

test('replays calls queued by the loader snippet in order', () => {
  const { init, log } = fakeInit();
  const FisCopilot = createCommandApi(init, () => {});
  FisCopilot.replay([['boot', { appId: 'eagle-star' }], ['update', { screen: 'NAV' }], ['error', { code: 'E1' }], ['open']]);
  assert.deepEqual(log, [['init', 'eagle-star'], ['update', { screen: 'NAV' }], ['setError', { code: 'E1' }], ['open', undefined]]);
});

test('commands before boot warn instead of throwing; boot twice replaces the instance', () => {
  const { init, log } = fakeInit();
  const warnings = [];
  const FisCopilot = createCommandApi(init, (w) => warnings.push(w));
  FisCopilot('open');
  FisCopilot('nope');
  assert.equal(warnings.length, 2);
  FisCopilot('boot', { appId: 'a' });
  FisCopilot('boot', { appId: 'b' });
  assert.deepEqual(log, [['init', 'a'], ['destroy', undefined], ['init', 'b']]);
  FisCopilot('ask', 'why?');
  FisCopilot('shutdown');
  assert.equal(FisCopilot.instance(), null);
  assert.deepEqual(log.slice(-2), [['ask', 'why?'], ['destroy', undefined]]);
});

test('a failing queued command does not stop the rest', () => {
  const FisCopilot = createCommandApi(() => {
    throw new Error('boom');
  }, () => {});
  assert.doesNotThrow(() => FisCopilot.replay([['boot', {}], ['open']]));
});
