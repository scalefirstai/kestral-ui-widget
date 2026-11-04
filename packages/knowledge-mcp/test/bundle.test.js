import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadBundle, parseFrontmatter } from '../src/bundle.js';
import { createHandler } from '../src/server.js';

const bundle = loadBundle(fileURLToPath(new URL('../../../knowledge/okf', import.meta.url)));
const EAGLE = ['fund-accounting/eagle-star', 'shared'];

test('loads concepts and skips reserved index/log files', () => {
  assert.equal(bundle.size, 9);
  assert.equal(bundle.get('/index.md'), null);
});

test('parses OKF frontmatter: scalars, inline lists, quoted strings, block lists', () => {
  const { meta, body } = parseFrontmatter('---\ntype: Runbook\ntitle: "A: b"\ntags: [x, y]\nowners:\n  - p\n  - q\n---\n# Body');
  assert.deepEqual(meta, { type: 'Runbook', title: 'A: b', tags: ['x', 'y'], owners: ['p', 'q'] });
  assert.equal(body, '# Body');
});

test('search ranks the relevant runbook first', () => {
  const [top] = bundle.search({ query: 'NAV batch failed overnight', namespaces: EAGLE });
  assert.equal(top.path, '/runbooks/nav-batch-failure.md');
  assert.equal(top.source, 'runbook');
  assert.match(top.resource, /^https:\/\//);
});

test('search by JIRA key', () => {
  const [top] = bundle.search({ query: 'what is FUND-1423', namespaces: EAGLE });
  assert.equal(top.path, '/jira/FUND-1423.md');
});

test('namespaces scope search, get and links', () => {
  const ta = bundle.search({ query: 'dividend reinvestment stuck', namespaces: EAGLE });
  assert.ok(ta.every((r) => r.namespace.startsWith('fund-accounting/')));
  assert.equal(bundle.get('/jira/TA-882.md', EAGLE), null);
  assert.ok(bundle.get('/jira/TA-882.md', ['transfer-agency/ta-portal']));
  assert.ok(bundle.get('/jira/TA-882.md', ['transfer-agency']), 'parent namespace grants children');
});

test('get_concept returns content and bundle-relative links', () => {
  const c = bundle.get('runbooks/nav-batch-failure.md', EAGLE);
  assert.match(c.content, /ES_NAV_MAIN/);
  assert.ok(c.links.some((l) => l.path === '/jira/FUND-1423.md'));
});

test('MCP handler: initialize, tools/list, tools/call, unknown method', () => {
  const h = createHandler(bundle);
  assert.equal(h({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }).result.serverInfo.name, 'fis-knowledge-mock');
  assert.equal(h({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.deepEqual(h({ jsonrpc: '2.0', id: 2, method: 'tools/list' }).result.tools.map((t) => t.name), ['search_concepts', 'get_concept', 'list_links']);
  const r = h({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_concepts', arguments: { query: 'price tolerance', namespaces: EAGLE } } });
  assert.equal(r.result.isError, false);
  assert.ok(JSON.parse(r.result.content[0].text).results.length > 0);
  assert.equal(h({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_concept', arguments: { path: '/nope.md' } } }).result.isError, true);
  assert.equal(h({ jsonrpc: '2.0', id: 5, method: 'bogus' }).error.code, -32601);
});
