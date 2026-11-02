// Talks to the gateway. Streams over SSE (fetch + ReadableStream) and falls back to
// a single JSON response when streaming is disabled or the host blocks streamed bodies
// (some corporate proxies buffer text/event-stream).
import { createSseParser } from './sse.js';

export class GatewayError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.gatewayUrl   base URL, e.g. https://copilot-gw.fis.internal
 * @param {object} opts.body         request body (see docs/PROTOCOL.md)
 * @param {string|null} opts.token   bearer token, or null when the gateway uses cookies / Windows auth
 * @param {boolean} opts.stream
 * @param {AbortSignal} [opts.signal]
 * @param {(evt:{event:string,data:any})=>void} opts.onEvent
 */
export async function sendChat({ gatewayUrl, body, token, stream, signal, onEvent, fetchImpl }) {
  const doFetch = fetchImpl || fetch;
  const headers = {
    'Content-Type': 'application/json',
    Accept: stream ? 'text/event-stream' : 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await doFetch(`${trimSlash(gatewayUrl)}/v1/chat${stream ? '' : '?stream=false'}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
    // 'include' lets the gateway use cookie / Windows-integrated auth when no token is given.
    credentials: token ? 'omit' : 'include',
  });

  if (!res.ok) {
    let detail = {};
    try {
      detail = await res.json();
    } catch {
      /* non-JSON error body */
    }
    throw new GatewayError(detail.message || `Gateway returned ${res.status}`, res.status, detail.code);
  }

  const type = res.headers.get('content-type') || '';
  if (!stream || !type.includes('text/event-stream') || !res.body) {
    const json = await res.json();
    if (json.text) onEvent({ event: 'token', data: { text: json.text } });
    (json.citations || []).forEach((c) => onEvent({ event: 'citation', data: c }));
    onEvent({ event: 'done', data: { messageId: json.messageId, conversationId: json.conversationId } });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parse = createSseParser();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const evt of parse(decoder.decode(value, { stream: true }))) {
      if (evt.event === 'error') {
        throw new GatewayError(evt.data.message || 'Assistant error', 502, evt.data.code);
      }
      onEvent(evt);
    }
  }
}

export async function sendFeedback({ gatewayUrl, token, body, fetchImpl }) {
  const doFetch = fetchImpl || fetch;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  await doFetch(`${trimSlash(gatewayUrl)}/v1/feedback`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: token ? 'omit' : 'include',
  });
}

function trimSlash(url) {
  return String(url).replace(/\/+$/, '');
}
