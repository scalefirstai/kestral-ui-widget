import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/markdown.js';

test('escapes raw HTML from the model', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> hi');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
});

test('renders bold, code and lists', () => {
  const html = renderMarkdown('Run **restart** with `job-42`\n- one\n- two');
  assert.match(html, /<strong>restart<\/strong>/);
  assert.match(html, /<code>job-42<\/code>/);
  assert.match(html, /<ul>\n<li>one<\/li>\n<li>two<\/li>\n<\/ul>/);
});

test('fenced code is escaped and untouched by inline rules', () => {
  const html = renderMarkdown('```sql\nSELECT * FROM t WHERE a < 3 -- **x**\n```');
  assert.match(html, /<pre><code data-lang="sql">SELECT \* FROM t WHERE a &lt; 3 -- \*\*x\*\*<\/code><\/pre>/);
});

test('underscore italics, but not inside identifiers', () => {
  assert.match(renderMarkdown('see _this_ now'), /<em>this<\/em>/);
  assert.ok(!renderMarkdown('run nav_job_daily').includes('<em>'));
});

test('only http(s) links become anchors', () => {
  assert.match(renderMarkdown('[runbook](https://wiki/x)'), /<a href="https:\/\/wiki\/x"/);
  assert.ok(!renderMarkdown('[x](javascript:alert(1))').includes('<a'));
});
