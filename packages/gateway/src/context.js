// Server-side view of the widget's screen context. The widget's copy is a convenience; this one is
// what Eliza sees. Identity keys (appId, appMnemonic) come from the request/app registry, never from
// free-form context, and the whole object is bounded in size.
const MNEMONIC_RE = /^[A-Z0-9]{3}$/;
const MAX_STRING = 500;
const MAX_KEYS = 40;
const MAX_DEPTH = 3;
const STANDARD = ['appMnemonic', 'appId', 'screen', 'route', 'url', 'host', 'error'];

export function isMnemonic(v) {
  return typeof v === 'string' && MNEMONIC_RE.test(v);
}

// Registry mnemonic wins; a widget that sends a different one is misconfigured (or spoofing).
export function resolveMnemonic(body, app) {
  const sent = typeof body.appMnemonic === 'string' ? body.appMnemonic.toUpperCase() : null;
  const registered = app && app.mnemonic ? String(app.mnemonic).toUpperCase() : null;
  if (registered && sent && sent !== registered) return { error: `appMnemonic "${sent}" does not match ${body.appId} (${registered})` };
  return { mnemonic: registered || sent || null };
}

export function normalizeContext(raw, { appId, appMnemonic }) {
  const ctx = sanitize(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}, 0) || {};
  const error = normalizeError(ctx.error);
  const out = { appMnemonic, appId, screen: typeof ctx.screen === 'string' ? ctx.screen : null, error };
  for (const k of ['route', 'url', 'host']) if (typeof ctx[k] === 'string') out[k] = ctx[k];
  const custom = {};
  for (const k of Object.keys(ctx)) if (!STANDARD.includes(k)) custom[k] = ctx[k];
  if (Object.keys(custom).length) out.custom = custom;
  return out;
}

function normalizeError(e) {
  if (e == null) return null;
  if (typeof e === 'string') return { message: e };
  if (typeof e !== 'object') return null;
  const out = {};
  for (const k of ['code', 'message', 'source', 'occurredAt', 'jobName', 'severity', 'correlationId']) {
    if (e[k] != null && typeof e[k] !== 'object') out[k] = String(e[k]);
  }
  return out.code || out.message ? out : null;
}

function sanitize(v, depth) {
  if (v === null) return null;
  if (typeof v === 'string') return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING - 1)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v !== 'object' || depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => sanitize(x, depth + 1)).filter((x) => x !== undefined);
  const out = {};
  for (const k of Object.keys(v).slice(0, MAX_KEYS)) {
    const x = sanitize(v[k], depth + 1);
    if (x !== undefined) out[k] = x;
  }
  return out;
}

// Short, stable rendering for prompts and the mock backend.
export function describeContext(c) {
  const lines = [`Application: ${c.appMnemonic || '?'} (${c.appId})`];
  if (c.screen) lines.push(`Screen: ${c.screen}`);
  if (c.route) lines.push(`Route: ${c.route}`);
  if (c.error) {
    const e = c.error;
    lines.push(`Error on screen: ${[e.code, e.message].filter(Boolean).join(' - ')}${e.jobName ? ` (job ${e.jobName})` : ''}`);
  }
  if (c.custom) lines.push(`Other: ${JSON.stringify(c.custom)}`);
  return lines.join('\n');
}
