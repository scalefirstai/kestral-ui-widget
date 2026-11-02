import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendChat, GatewayError } from '../src/transport.js';

function streamResponse(chunks) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(c) {
      chunks.forEach((x) => c.enqueue(enc.encode(x)));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

test('streams tokens, citations and done', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return streamResponse([
      'event: token\ndata: {"text":"Hel"}\n\n',
      'event: token\ndata: {"text":"lo"}\n\nevent: citation\ndata: {"title":"KB-1","url":"https://kb/1"}\n\n',
      'event: done\ndata: {"messageId":"m9"}\n\n',
    ]);
  };
  const events = [];
  await sendChat({ gatewayUrl: 'https://gw/', body: { message: 'x' }, token: 't', stream: true, onEvent: (e) => events.push(e), fetchImpl });
  assert.equal(seen.url, 'https://gw/v1/chat');
  assert.equal(seen.init.headers.Authorization, 'Bearer t');
  assert.equal(seen.init.credentials, 'omit');
  assert.deepEqual(events.map((e) => e.event), ['token', 'token', 'citation', 'done']);
});

test('no token means cookie / Windows auth (credentials include)', async () => {
  let init;
  const fetchImpl = async (_u, i) => {
    init = i;
    return new Response(JSON.stringify({ text: 'ok', messageId: 'm1' }), { headers: { 'content-type': 'application/json' } });
  };
  const events = [];
  await sendChat({ gatewayUrl: 'https://gw', body: {}, token: null, stream: false, onEvent: (e) => events.push(e), fetchImpl });
  assert.equal(init.credentials, 'include');
  assert.equal(init.headers.Authorization, undefined);
  assert.deepEqual(events, [
    { event: 'token', data: { text: 'ok' } },
    { event: 'done', data: { messageId: 'm1', conversationId: undefined } },
  ]);
});

test('HTTP errors surface as GatewayError with status', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ message: 'nope', code: 'forbidden' }), { status: 403 });
  await assert.rejects(
    sendChat({ gatewayUrl: 'https://gw', body: {}, token: 't', stream: true, onEvent: () => {}, fetchImpl }),
    (e) => e instanceof GatewayError && e.status === 403 && e.code === 'forbidden',
  );
});

test('error event mid-stream rejects', async () => {
  const fetchImpl = async () => streamResponse(['event: token\ndata: {"text":"a"}\n\n', 'event: error\ndata: {"message":"eliza down"}\n\n']);
  await assert.rejects(
    sendChat({ gatewayUrl: 'https://gw', body: {}, token: 't', stream: true, onEvent: () => {}, fetchImpl }),
    /eliza down/,
  );
});
