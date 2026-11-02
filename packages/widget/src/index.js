// Public entry point.
//
// Script tag (legacy web, ASP.NET, WebView2, Electron):
//   <script src="fis-copilot.js" data-gateway-url="https://..." data-app-id="eagle-star" defer></script>
//   or call FisCopilot.init({...}) yourself.
//
// npm (modern SPA):
//   import { init } from '@fis/support-copilot';
//   const copilot = init({ gatewayUrl, appId, getToken });
import { createUi } from './ui.js';
import { sendChat, sendFeedback, GatewayError } from './transport.js';
import { resolveToken, resolveContext, detectHost } from './host.js';

export const VERSION = '0.1.0';

const DEFAULTS = {
  gatewayUrl: '',
  appId: '',
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
  onEvent: null, // analytics hook: (name, payload) => void
};

let singleton = null;

export function init(userConfig = {}) {
  const config = { ...DEFAULTS, ...userConfig };
  if (!config.gatewayUrl) throw new Error('FisCopilot: gatewayUrl is required');
  if (!config.appId) throw new Error('FisCopilot: appId is required');
  if (singleton && !config.container) singleton.destroy();

  const state = { conversationId: newId(), history: [], inflight: null };
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
      const [token, context] = await Promise.all([resolveToken(config), resolveContext(config)]);
      const body = {
        conversationId: state.conversationId,
        appId: config.appId,
        namespace: config.namespace || config.appId,
        message: text,
        history: state.history.slice(-config.maxHistory),
        context,
        client: { version: VERSION, host: detectHost() },
      };
      emit('ask', { appId: config.appId, length: text.length });

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
    destroy() {
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

// Auto-init from <script data-*> attributes when loaded as a plain script.
(function autoInit() {
  if (typeof document === 'undefined') return;
  const script = document.currentScript;
  if (!script || !script.dataset || !script.dataset.gatewayUrl) return;
  const d = script.dataset;
  const start = () =>
    init({
      gatewayUrl: d.gatewayUrl,
      appId: d.appId,
      namespace: d.namespace,
      title: d.title || DEFAULTS.title,
      subtitle: d.subtitle || '',
      position: d.position || DEFAULTS.position,
      colorScheme: d.colorScheme || 'auto',
      theme: d.accent ? { accent: d.accent } : {},
      stream: d.stream !== 'false',
    });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
