// Eliza adapters. Every adapter exposes the same async generator:
//
//   chat(request, { signal }) -> AsyncIterable<{ type: 'token'|'citation'|'done', ... }>
//
// The gateway turns those into SSE for the widget, so swapping Eliza's wire format only
// touches this file.
//
//   ELIZA_MODE=http    real Eliza (production). Placeholder contract below, see ADAPT HERE.
//   ELIZA_MODE=claude  local stand-in: Claude + the knowledge MCP server (claude.js).
//   ELIZA_MODE=mock    canned answer, no network (tests, CI, UI work).
import { claudeEliza } from './claude.js';
import { normalizeContext, describeContext } from './context.js';

export function createEliza(cfg, opts) {
  if (cfg.elizaMode === 'mock') return mockEliza();
  if (cfg.elizaMode === 'claude') return claudeEliza(cfg, opts);
  return httpEliza(cfg);
}

export function buildElizaRequest({ body, user, app, cfg }) {
  const namespace = body.namespace || body.appId;
  const appMnemonic = body.appMnemonic || app?.mnemonic || null;
  const context = normalizeContext(body.context, { appId: body.appId, appMnemonic });
  const system = [
    `You are the production support copilot for the "${app?.name || body.appId}" application${appMnemonic ? ` (mnemonic ${appMnemonic})` : ''} in BNY Fund & Investor Services.`,
    `Answer from the knowledge base only. Use the "${cfg.knowledgeTool}" tools, restricted to namespace "${namespace}" and the shared platform namespace.`,
    'Cite the runbook, Confluence page or JIRA issue you used. If the knowledge base has no answer, say so and suggest who to contact; do not guess.',
    'Never instruct the user to change production data directly.',
    'Each question comes with the user\'s screen context: application mnemonic, screen and, if present, the error on screen. When an error is present, diagnose that error first.',
  ].join('\n');

  return {
    conversationId: body.conversationId,
    user: { id: user.userId },
    messages: [
      { role: 'system', content: system },
      ...sanitizeHistory(body.history),
      { role: 'user', content: body.message },
    ],
    metadata: {
      appId: body.appId,
      appMnemonic,
      namespace,
      allowedNamespaces: app?.namespaces || [namespace, 'shared'],
      context,
      contextSummary: describeContext(context),
      client: body.client || {},
    },
    tools: { mcpServers: [cfg.knowledgeTool] },
    stream: true,
  };
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
}

// ---------------------------------------------------------------------------
// HTTP adapter.
// ADAPT HERE: the endpoint path, auth header and event names below are assumptions about
// Eliza's API. Map them to Eliza's real contract; keep the yielded shapes the same.
// ---------------------------------------------------------------------------
function httpEliza(cfg) {
  return {
    async *chat(request, { signal, userToken } = {}) {
      const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
      if (cfg.elizaApiKey) headers['X-Api-Key'] = cfg.elizaApiKey;
      if (userToken) headers.Authorization = `Bearer ${userToken}`; // on-behalf-of the user

      const timeout = AbortSignal.timeout(cfg.elizaTimeoutMs);
      const res = await fetch(`${cfg.elizaUrl.replace(/\/+$/, '')}/v1/conversations/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!res.ok) {
        const err = new Error(`Eliza returned ${res.status}`);
        err.status = res.status === 401 || res.status === 403 ? res.status : 502;
        throw err;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n?/g, '\n');
        let i;
        while ((i = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const data = block
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trimStart())
            .join('\n');
          if (!data || data === '[DONE]') continue;
          let msg;
          try {
            msg = JSON.parse(data);
          } catch {
            continue;
          }
          // Expected Eliza event types (adjust to the real ones):
          if (msg.type === 'delta' && msg.text) yield { type: 'token', text: msg.text };
          else if (msg.type === 'citation') yield { type: 'citation', title: msg.title, url: msg.url, source: msg.source };
          else if (msg.type === 'final') yield { type: 'done', messageId: msg.messageId };
          else if (msg.type === 'error') throw Object.assign(new Error(msg.message || 'Eliza error'), { status: 502 });
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Mock adapter: lets you run the whole stack locally and in CI with no Eliza.
// ---------------------------------------------------------------------------
function mockEliza() {
  return {
    async *chat(request) {
      const q = request.messages[request.messages.length - 1].content;
      const ns = request.metadata.namespace;
      const ctx = request.metadata.context;
      const answer =
        `**Mock answer** for \`${ns}\`.\n\n` +
        `You asked: _${q.slice(0, 200)}_\n\n` +
        `Context received: app \`${ctx.appMnemonic}\`, screen _${ctx.screen || 'unknown'}_` +
        (ctx.error ? `, error \`${ctx.error.code || ctx.error.message}\`` : ', no error') +
        '.\n\n' +
        '1. Check the overnight batch status in the scheduler.\n' +
        '2. If the job failed, follow the restart runbook.\n' +
        '3. Raise a JIRA in the support queue if it fails twice.';
      for (const word of answer.split(/(\s+)/)) {
        await new Promise((r) => setTimeout(r, 5));
        yield { type: 'token', text: word };
      }
      yield { type: 'citation', title: 'Restart runbook', url: 'https://confluence.example.internal/display/FIS/Restart', source: 'confluence' };
      yield { type: 'citation', title: 'FUND-1423', url: 'https://jira.example.internal/browse/FUND-1423', source: 'jira' };
      yield { type: 'done', messageId: `mock-${Date.now()}` };
    },
  };
}
