import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSseParser } from '../src/sse.js';

test('parses complete events', () => {
  const push = createSseParser();
  const evts = push('event: token\ndata: {"text":"Hi"}\n\nevent: done\ndata: {"messageId":"m1"}\n\n');
  assert.deepEqual(evts, [
    { event: 'token', data: { text: 'Hi' } },
    { event: 'done', data: { messageId: 'm1' } },
  ]);
});

test('buffers events split across chunks', () => {
  const push = createSseParser();
  assert.deepEqual(push('event: tok'), []);
  assert.deepEqual(push('en\ndata: {"text":"a'), []);
  assert.deepEqual(push('b"}\n\n'), [{ event: 'token', data: { text: 'ab' } }]);
});

test('ignores comments and handles CRLF', () => {
  const push = createSseParser();
  const evts = push(': keep-alive\r\n\r\ndata: {"text":"x"}\r\n\r\n');
  assert.deepEqual(evts, [{ event: 'message', data: { text: 'x' } }]);
});

test('non-JSON data becomes text', () => {
  const push = createSseParser();
  assert.deepEqual(push('data: plain\n\n'), [{ event: 'message', data: { text: 'plain' } }]);
});
