import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { claudeEliza, toClaudeConversation } from '../src/claude.js';
import { buildElizaRequest } from '../src/eliza.js';
import { loadConfig } from '../src/config.js';
import { loadBundle } from '../../knowledge-mcp/src/bundle.js';
import { createHandler } from '../../knowledge-mcp/src/server.js';

const cfg = loadConfig({ ELIZA_MODE: 'claude' });
const app = { name: 'Eagle STAR', mnemonic: 'ESR', namespaces: ['fund-accounting/eagle-star', 'shared'] };
const request = buildElizaRequest({
  body: { appId: 'eagle-star', namespace: 'fund-accounting/eagle-star', message: 'NAV batch failed with ORA-00060', appMnemonic: 'ESR', context: { screen: 'NAV Dashboard', error: { code: 'ORA-00060', message: 'deadlock detected', jobName: 'ES_NAV_ACCRUALS' } } },
  user: { userId: 'u1' },
  app,
  cfg,
});

// In-process MCP: the real mock server's handler over the sample OKF bundle, with calls recorded.
function inProcessMcp() {
  const handle = createHandler(loadBundle(fileURLToPath(new URL('../../../knowledge/okf', import.meta.url))));
  const calls = [];
  let id = 0;
  return {
    calls,
    listTools: async () => handle({ jsonrpc: '2.0', id: ++id, method: 'tools/list' }).result.tools,
    callTool: async (name, args) => {
      calls.push({ name, args });
      return handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }).result;
    },
  };
}

// Fake Anthropic client that plays a scripted list of assistant turns through the streaming interface.
function fakeClient(turns) {
  const requests = [];
  return {
    requests,
    beta: {
      messages: {
        stream(params) {
          requests.push(structuredClone(params));
          const msg = { id: `msg_${requests.length}`, ...turns[requests.length - 1] };
          return {
            async *[Symbol.asyncIterator]() {
              for (const b of msg.content) {
                yield { type: 'content_block_start', content_block: b };
                if (b.type === 'text') for (const w of b.text.split(/(?= )/)) yield { type: 'content_block_delta', delta: { type: 'text_delta', text: w } };
              }
            },
            finalMessage: async () => msg,
          };
        },
      },
    },
  };
}

async function collect(iter) {
  const out = [];
  for await (const e of iter) out.push(e);
  return out;
}

test('runs the MCP tool loop, scopes namespaces, streams text and cites what it read', async () => {
  const mcp = inProcessMcp();
  const client = fakeClient([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'search_concepts', input: { query: 'ORA-00060 accruals', namespaces: ['transfer-agency'] } }] },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'get_concept', input: { path: '/jira/FUND-1423.md' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Known issue FUND-1423. Restart ES_NAV_ACCRUALS.' }] },
  ]);
  const events = await collect(claudeEliza(cfg, { client, mcp }).chat(request));

  // The model's own namespaces argument is ignored; the app's registered namespaces are enforced.
  assert.deepEqual(mcp.calls.map((c) => c.args.namespaces), [app.namespaces, app.namespaces]);
  // Tool schemas shown to the model have no namespaces parameter.
  assert.ok(client.requests[0].tools.every((t) => !('namespaces' in t.input_schema.properties)));
  // Tool results go back to the model; the full assistant content is kept.
  const second = client.requests[1].messages;
  assert.equal(second.at(-1).content[0].tool_use_id, 't1');
  assert.match(second.at(-1).content[0].content, /FUND-1423/);
  assert.equal(client.requests[0].model, 'claude-opus-5-5');
  assert.equal(client.requests[0].system[0].cache_control.type, 'ephemeral');

  const text = events.filter((e) => e.type === 'token').map((e) => e.text).join('');
  assert.equal(text, 'Known issue FUND-1423. Restart ES_NAV_ACCRUALS.');
  const cites = events.filter((e) => e.type === 'citation');
  assert.deepEqual(cites.map((c) => c.url), ['https://jira.example.internal/browse/FUND-1423']);
  assert.deepEqual(events.at(-1), { type: 'done', messageId: 'msg_3' });
});

test('a concept outside the app namespaces is not readable', async () => {
  const mcp = inProcessMcp();
  const client = fakeClient([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'get_concept', input: { path: '/jira/TA-882.md' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Not found.' }] },
  ]);
  const events = await collect(claudeEliza(cfg, { client, mcp }).chat(request));
  const result = client.requests[1].messages.at(-1).content[0];
  assert.equal(result.is_error, true);
  assert.equal(events.filter((e) => e.type === 'citation').length, 0);
});

test('malformed tool input is returned as an error, not executed', async () => {
  const mcp = inProcessMcp();
  const client = fakeClient([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'search_concepts', input: {} }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] },
  ]);
  await collect(claudeEliza(cfg, { client, mcp }).chat(request));
  assert.equal(mcp.calls.length, 0);
  assert.match(client.requests[1].messages.at(-1).content[0].content, /INVALID_INPUT/);
});

test('refusal yields a safe message', async () => {
  const client = fakeClient([{ stop_reason: 'refusal', content: [] }]);
  const events = await collect(claudeEliza(cfg, { client, mcp: inProcessMcp() }).chat(request));
  assert.match(events[0].text, /can’t help/);
});

test('conversation mapping: system prompt is stable, screen context goes in the user turn', () => {
  const { system, messages } = toClaudeConversation(request);
  assert.match(system, /Eagle STAR/);
  assert.doesNotMatch(system, /NAV Dashboard/);
  assert.match(system, /mnemonic ESR/);
  const turn = messages.at(-1).content;
  assert.match(turn, /^<screen_context>\nApplication: ESR \(eagle-star\)\nScreen: NAV Dashboard\nError on screen: ORA-00060 - deadlock detected \(job ES_NAV_ACCRUALS\)\n<\/screen_context>/);
});
