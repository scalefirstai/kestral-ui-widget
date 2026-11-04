// Public API.
//
// Hosted script tag (any web page, ASP.NET, Angular, React, WebView2, Electron): see global.js for the
// loader snippet, the FisCopilot('boot', …) command API and data-attribute embedding.
//
// npm (modern SPA):
//   import { init } from '@fis/support-copilot';
//   const copilot = init({ gatewayUrl, appId, getToken });
import { createUi } from './ui.js';
import { sendChat, sendFeedback, GatewayError } from './transport.js';
import { resolveToken, resolveContext, detectHost } from './host.js';
import { buildContext, normalizeMnemonic, normalizeError, captureErrors, describeContext } from './context.js';

export const VERSION = '0.1.0';

const DEFAULTS = {
  gatewayUrl: '',
  appId: '',
  appMnemonic: '', // 3-character BNY application code, e.g. 'ESR'. Sent with every question.
  namespace: '', // e.g. 'fund-accounting/eagle-star' — scopes retrieval to this app's knowledge
  title: 'Support Copilot',
  subtitle: '',
  placeholder: 'Ask about an error, job, or how-to…',
  footer: 'AI-generated answers. Check before acting on production.',
  position: 'bottom-right', // or 'bottom-left'
  container: null, // selector/element to render inline instead of a floating launcher
  colorScheme: 'auto', // 'auto' | 'light' | 'dark'
  theme: {}, // { accent: '#0b5cad' }
  stream: true,
  suggestions: [],
  maxInputChars: 4000,
  maxHistory: 12, // turns sent back to the gateway for context
  getToken: null,
  getContext: null,
  context: null, // initial screen context; FisCopilot('update', {...}) merges into it
  captureErrors: true, // remember the latest uncaught error / unhandled rejection on the host page
  onEvent: null, // analytics hook: (name, payload) => void
};

let singleton = null;

export function init(userConfig = {}) {
  const config = { ...DEFAULTS, ...userConfig };
  if (!config.gatewayUrl) throw new Error('FisCopilot: gatewayUrl is required');
  if (!config.appId) throw new Error('FisCopilot: appId is required');
  config.appMnemonic = normalizeMnemonic(config.appMnemonic);
  if (!config.appMnemonic) throw new Error('FisCopilot: appMnemonic is required (3-character application code, e.g. "ESR")');
  if (singleton && !config.container) singleton.destroy();

  const state = { conversationId: newId(), history: [], inflight: null, updates: {}, capturedError: null };
  const emit = (name, payload) => {
    try {
      config.onEvent && config.onEvent(name, payload);
    } catch {
      /* host analytics must never break the widget */
    }
  };

  const ui = createUi(config, {
    onSend: (text) => ask(text),
    onReset: () => reset(),
    onToggle: (open) => emit(open ? 'open' : 'close', {}),
  });
  ui.setSuggestions(config.suggestions);
  const stopCapture = config.captureErrors
    ? captureErrors(typeof window !== 'undefined' ? window : null, (err) => {
        if (!err) return;
        state.capturedError = err;
        refreshContextLabel();
      })
    : () => {};

  function currentContext(live) {
    return buildContext({ config, updates: state.updates, live, capturedError: state.capturedError });
  }

  function refreshContextLabel() {
    ui.setContextLabel(describeContext(currentContext()));
  }
  refreshContextLabel();

  async function ask(text) {
    if (state.inflight) return;
    ui.setSuggestions([]);
    ui.addUser(text);
    ui.setBusy(true);
    const bot = ui.addBotMessage();
    const controller = new AbortController();
    state.inflight = controller;
    let messageId = null;

    try {
      const [token, live] = await Promise.all([resolveToken(config), resolveContext(config)]);
      const context = currentContext(live);
      ui.setContextLabel(describeContext(context));
      const body = {
        conversationId: state.conversationId,
        appId: config.appId,
        appMnemonic: config.appMnemonic,
        namespace: config.namespace || config.appId,
        message: text,
        history: state.history.slice(-config.maxHistory),
        context,
        client: { version: VERSION, host: detectHost() },
      };
      emit('ask', { appId: config.appId, appMnemonic: config.appMnemonic, screen: context.screen, hasError: !!context.error, length: text.length });

      await sendChat({
        gatewayUrl: config.gatewayUrl,
        body,
        token,
        stream: config.stream,
        signal: controller.signal,
        onEvent: ({ event, data }) => {
          if (event === 'token') bot.append(data.text || '');
          else if (event === 'citation') bot.addCitation(data);
          else if (event === 'done') messageId = data.messageId || null;
        },
      });

      const answer = bot.finish({
        onFeedback: (rating) => {
          emit('feedback', { rating, messageId });
          resolveToken(config)
            .then((t) =>
              sendFeedback({
                gatewayUrl: config.gatewayUrl,
                token: t,
                body: { conversationId: state.conversationId, messageId, appId: config.appId, rating },
              }),
            )
            .catch(() => {});
        },
      });
      state.history.push({ role: 'user', content: text }, { role: 'assistant', content: answer });
    } catch (err) {
      bot.finish();
      if (err && err.name === 'AbortError') return;
      ui.addError(friendlyError(err));
      emit('error', { message: String(err && err.message), status: err && err.status });
    } finally {
      state.inflight = null;
      ui.setBusy(false);
    }
  }

  function reset() {
    if (state.inflight) state.inflight.abort();
    state.conversationId = newId();
    state.history = [];
    ui.clear();
    ui.setSuggestions(config.suggestions);
    emit('reset', {});
  }

  const api = {
    open: ui.open,
    close: ui.close,
    ask,
    reset,
    // Merge screen context, e.g. on route change: update({ screen: 'Pricing', fundId: 'F1' }).
    // A key set to null is removed; { error: null } clears the current error.
    update(ctx) {
      if (!ctx || typeof ctx !== 'object') return;
      Object.keys(ctx).forEach((k) => {
        if (ctx[k] === null && k !== 'error') delete state.updates[k];
        else state.updates[k] = ctx[k];
      });
      if (ctx.error === null) state.capturedError = null;
      refreshContextLabel();
    },
    // The error the user is looking at (Error, { code, message, jobName }, or a string); null clears it.
    setError(err) {
      api.update({ error: err == null ? null : normalizeError(err, 'host') });
    },
    getContext: () => currentContext(),
    destroy() {
      stopCapture();
      if (state.inflight) state.inflight.abort();
      ui.destroy();
      if (singleton === api) singleton = null;
    },
  };
  if (!config.container) singleton = api;
  return api;
}

function friendlyError(err) {
  if (err instanceof GatewayError) {
    if (err.status === 401 || err.status === 403) return 'You are not signed in to the support copilot, or you lack access to this application.';
    if (err.status === 429) return 'Too many requests. Wait a moment and try again.';
    if (err.status >= 500) return 'The support copilot is unavailable right now. Try again shortly.';
    return err.message;
  }
  return 'Could not reach the support copilot. Check your network or VPN.';
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
