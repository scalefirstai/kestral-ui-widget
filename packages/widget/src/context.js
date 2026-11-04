// Screen context sent with every question, so answers are about where the user is and what just failed.
//
// Standard keys (see docs/PROTOCOL.md):
//   appMnemonic  3-character BNY application code, e.g. "ESR". Required at boot.
//   appId        registry id, e.g. "eagle-star"
//   screen       current screen / page name (defaults to document.title)
//   route        SPA route or page path
//   error        { code, message, source, occurredAt } for the error the user is looking at, or null
//   host, url    filled in by the host bridge
// Anything else (fundId, jobName, valuationDate…) passes through as custom keys.
//
// Precedence, lowest to highest: defaults < captured page error < FisCopilot('update' | 'error') < live getContext().

export const MNEMONIC_RE = /^[A-Z0-9]{3}$/;
const MAX_STRING = 500;
const MAX_KEYS = 40;
const MAX_DEPTH = 3;
const ERROR_TTL_MS = 15 * 60 * 1000; // a captured page error older than this is no longer "the" error

export function normalizeMnemonic(value) {
  const m = String(value == null ? '' : value).trim().toUpperCase();
  return MNEMONIC_RE.test(m) ? m : null;
}

// Accepts an Error, an ErrorEvent, a PromiseRejectionEvent, a string or a plain { code, message } object.
export function normalizeError(input, source = 'host') {
  if (input == null) return null;
  let e = input;
  if (e && e.reason !== undefined && e.type === 'unhandledrejection') e = e.reason;
  else if (e && e.error !== undefined && e.type === 'error') e = e.error || { message: input.message };
  if (typeof e === 'string') e = { message: e };
  if (typeof e !== 'object') e = { message: String(e) };

  const out = {
    code: str(e.code || e.errorCode || e.status || e.name || ''),
    message: str(e.message || e.description || ''),
    source: str(e.source || source),
    occurredAt: str(e.occurredAt || new Date().toISOString()),
  };
  for (const k of ['jobName', 'severity', 'correlationId']) if (e[k] != null) out[k] = str(e[k]);
  if (!out.code) delete out.code;
  if (!out.message && !out.code) return null;
  return out;
}

export function buildContext({ config, updates, live, capturedError, now = Date.now(), title = docTitle() }) {
  const ctx = { appId: config.appId, appMnemonic: config.appMnemonic, screen: title || undefined, error: null };
  if (capturedError && now - Date.parse(capturedError.occurredAt) < ERROR_TTL_MS) ctx.error = capturedError;
  Object.assign(ctx, config.context || {}, updates || {}, live || {});
  ctx.appMnemonic = config.appMnemonic; // identity keys are not overridable from context
  ctx.appId = config.appId;
  if (ctx.error != null) ctx.error = normalizeError(ctx.error, 'host');
  return sanitizeContext(ctx);
}

// JSON-safe copy with bounded size: no functions, limited depth, keys and string length.
export function sanitizeContext(value, depth = 0) {
  if (value == null) return value === undefined ? undefined : null;
  if (typeof value === 'string') return str(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object' || depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitizeContext(v, depth + 1)).filter((v) => v !== undefined);
  const out = {};
  let n = 0;
  for (const k of Object.keys(value)) {
    if (n >= MAX_KEYS) break;
    const v = sanitizeContext(value[k], depth + 1);
    if (v === undefined) continue;
    out[k] = v;
    n++;
  }
  return out;
}

// Listens for uncaught errors and unhandled rejections on the host page and keeps the latest one,
// so "why did that just fail?" works without the host wiring anything. Turn off with captureErrors: false.
export function captureErrors(target, onError) {
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  const onErr = (e) => onError(normalizeError(e, 'window.onerror'));
  const onRej = (e) => onError(normalizeError(e, 'unhandledrejection'));
  target.addEventListener('error', onErr);
  target.addEventListener('unhandledrejection', onRej);
  return () => {
    target.removeEventListener('error', onErr);
    target.removeEventListener('unhandledrejection', onRej);
  };
}

// One-line summary shown in the panel so users can see what is sent.
export function describeContext(ctx) {
  const parts = [ctx.appMnemonic, ctx.screen].filter(Boolean);
  if (ctx.error) parts.push(`⚠ ${ctx.error.code || ctx.error.message}`);
  return parts.join(' · ');
}

function str(v) {
  const s = String(v);
  return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING - 1)}…` : s;
}

function docTitle() {
  try {
    return typeof document !== 'undefined' ? document.title : '';
  } catch {
    return '';
  }
}
