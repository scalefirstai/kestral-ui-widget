// Gateway HTTP server. Zero runtime dependencies (Node >= 20).
//
//   GET  /health                 liveness
//   GET  /widget/fis-copilot.js  serves the built widget, so host apps need only one URL
//   POST /v1/chat                SSE stream (default) or JSON when ?stream=false
//   POST /v1/feedback            thumbs up/down
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.js';
import { authenticate } from './auth.js';
import { createEliza, buildElizaRequest } from './eliza.js';
import { isMnemonic, resolveMnemonic } from './context.js';

export function createServer(cfg, { verifyToken, log = jsonLog, eliza = createEliza(cfg, { log }) } = {}) {
  const limiter = createLimiter(cfg.rateLimitPerMin);

  return http.createServer(async (req, res) => {
    const reqId = randomUUID();
    const url = new URL(req.url, 'http://gateway');
    const cors = applyCors(req, res, cfg);

    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(cors ? 204 : 403).end();
        return;
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        return sendJson(res, 200, { status: 'ok', eliza: cfg.elizaMode });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/widget/')) {
        return serveWidget(res, cfg, url.pathname.slice('/widget/'.length));
      }
      if (req.method === 'POST' && (url.pathname === '/v1/chat' || url.pathname === '/v1/feedback')) {
        const user = authenticate(req, cfg, verifyToken);
        if (!limiter(user.userId)) throw httpError(429, 'rate_limited', 'Too many requests');
        const body = await readJson(req, cfg.maxBodyBytes);

        if (url.pathname === '/v1/feedback') {
          log({ event: 'feedback', reqId, user: user.userId, appId: body.appId, messageId: body.messageId, rating: body.rating });
          return sendJson(res, 202, { ok: true });
        }
        return await handleChat({ req, res, url, body, user, cfg, eliza, log, reqId });
      }
      sendJson(res, 404, { code: 'not_found', message: 'Not found' });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) log({ event: 'error', reqId, message: err.message });
      if (!res.headersSent) sendJson(res, status, { code: err.code || 'internal', message: status >= 500 ? 'Internal error' : err.message, reqId });
      else res.end();
    }
  });
}

async function handleChat({ req, res, url, body, user, cfg, eliza, log, reqId }) {
  validateChat(body);
  const app = cfg.apps ? cfg.apps.get(body.appId) : null;
  if (cfg.apps && !app) throw httpError(403, 'unknown_app', `Application "${body.appId}" is not registered for the copilot`);
  if (app && body.namespace && !app.namespaces.some((n) => body.namespace === n || body.namespace.startsWith(`${n}/`))) {
    throw httpError(403, 'namespace_denied', `Namespace "${body.namespace}" is not allowed for ${body.appId}`);
  }
  const { mnemonic, error: mnemonicError } = resolveMnemonic(body, app);
  if (mnemonicError) throw httpError(403, 'mnemonic_mismatch', mnemonicError);
  body.appMnemonic = mnemonic;

  const request = buildElizaRequest({ body, user, app, cfg });
  const started = Date.now();
  const stream = url.searchParams.get('stream') !== 'false';
  const abort = new AbortController();
  req.on('close', () => abort.abort());

  log({
    event: 'chat',
    reqId,
    user: user.userId,
    appId: body.appId,
    appMnemonic: request.metadata.appMnemonic,
    screen: request.metadata.context.screen,
    errorCode: request.metadata.context.error ? request.metadata.context.error.code || 'unknown' : undefined,
    namespace: request.metadata.namespace,
    conversationId: body.conversationId,
    host: body.client?.host,
    question: cfg.logContent ? body.message : undefined,
    questionLength: body.message.length,
  });

  const events = eliza.chat(request, { signal: abort.signal, userToken: user.token });

  if (!stream) {
    let text = '';
    const citations = [];
    let messageId;
    for await (const e of events) {
      if (e.type === 'token') text += e.text;
      else if (e.type === 'citation') citations.push(strip(e));
      else if (e.type === 'done') messageId = e.messageId;
    }
    log({ event: 'chat_done', reqId, ms: Date.now() - started, chars: text.length });
    return sendJson(res, 200, { text, citations, messageId, conversationId: body.conversationId });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // stop nginx-style proxies from buffering the stream
  });
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15000);
  let chars = 0;
  try {
    for await (const e of events) {
      if (e.type === 'token') chars += e.text.length;
      sse(res, e.type, strip(e));
    }
    log({ event: 'chat_done', reqId, ms: Date.now() - started, chars });
  } catch (err) {
    if (!abort.signal.aborted) {
      log({ event: 'error', reqId, message: err.message });
      sse(res, 'error', { code: 'assistant_error', message: 'The assistant failed to answer. Try again.' });
    }
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
}

function validateChat(b) {
  if (!b || typeof b !== 'object') throw httpError(400, 'bad_request', 'Body must be a JSON object');
  if (typeof b.appId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(b.appId)) throw httpError(400, 'bad_request', 'appId is invalid');
  if (typeof b.message !== 'string' || !b.message.trim()) throw httpError(400, 'bad_request', 'message is required');
  if (b.message.length > 4000) throw httpError(400, 'bad_request', 'message is too long');
  if (b.appMnemonic != null && !isMnemonic(String(b.appMnemonic).toUpperCase())) {
    throw httpError(400, 'bad_request', 'appMnemonic must be a 3-character application code');
  }
  if (b.context != null && (typeof b.context !== 'object' || Array.isArray(b.context))) throw httpError(400, 'bad_request', 'context must be an object');
  if (b.namespace != null && (typeof b.namespace !== 'string' || !/^[a-z0-9][a-z0-9/._-]{0,127}$/i.test(b.namespace))) {
    throw httpError(400, 'bad_request', 'namespace is invalid');
  }
}

function applyCors(req, res, cfg) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser callers (desktop HTTP clients, curl)
  if (!cfg.allowedOrigins.includes(origin) && !cfg.allowedOrigins.includes('*')) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

async function serveWidget(res, cfg, file) {
  if (!/^fis-copilot(\.esm)?\.js(\.map)?$/.test(file)) return sendJson(res, 404, { code: 'not_found', message: 'Not found' });
  try {
    const buf = await readFile(normalize(join(cfg.widgetDir, file)));
    res.writeHead(200, {
      'Content-Type': file.endsWith('.map') ? 'application/json' : 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.end(buf);
  } catch {
    sendJson(res, 404, { code: 'not_built', message: 'Widget not built. Run npm run build.' });
  }
}

function readJson(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(httpError(413, 'too_large', 'Request body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(httpError(400, 'bad_request', 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function createLimiter(perMin) {
  const hits = new Map();
  setInterval(() => hits.clear(), 60000).unref();
  return (key) => {
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    return n <= perMin;
  };
}

function strip(e) {
  const { type, ...rest } = e; // eslint-disable-line no-unused-vars
  return rest;
}

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function jsonLog(obj) {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...obj })}\n`);
}

// Run directly: node src/server.js
if (import.meta.url === `file://${process.argv[1]}`) {
  // Local dev convenience: values from ./.env, without overriding variables already set in the shell.
  if (existsSync('.env') && process.loadEnvFile) process.loadEnvFile('.env');
  const cfg = loadConfig();
  createServer(cfg).listen(cfg.port, cfg.host, () => {
    jsonLog({ event: 'listening', port: cfg.port, eliza: cfg.elizaMode, auth: cfg.authMode });
  });
}
