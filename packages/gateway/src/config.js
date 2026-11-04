// All configuration comes from environment variables so the same build runs in dev,
// UAT and prod. See .env.example at the repo root.
import { readFileSync, existsSync } from 'node:fs';
import { DEFAULT_MCP_COMMAND } from './claude.js';

export function loadConfig(env = process.env) {
  const cfg = {
    port: Number(env.PORT || 8787),
    host: env.HOST || '0.0.0.0',
    allowedOrigins: list(env.ALLOWED_ORIGINS), // empty = same-origin + non-browser hosts only
    authMode: env.AUTH_MODE || 'bearer', // 'bearer' | 'trusted-header' | 'none'
    trustedUserHeader: (env.TRUSTED_USER_HEADER || 'x-forwarded-user').toLowerCase(),
    elizaMode: env.ELIZA_MODE || 'http', // 'http' (real Eliza) | 'claude' (Claude + knowledge MCP stand-in) | 'mock'
    elizaUrl: env.ELIZA_URL || '',
    elizaApiKey: env.ELIZA_API_KEY || '',
    elizaTimeoutMs: Number(env.ELIZA_TIMEOUT_MS || 60000),
    knowledgeTool: env.KNOWLEDGE_MCP_SERVER || 'fis-knowledge', // MCP server Eliza should use for retrieval
    // ELIZA_MODE=claude only:
    claudeModel: env.CLAUDE_MODEL || 'claude-opus-5-5',
    claudeEffort: env.CLAUDE_EFFORT || 'medium', // low | medium | high | xhigh | max
    claudeMaxTurns: Number(env.CLAUDE_MAX_TURNS || 6), // model <-> tool round trips per question
    knowledgeMcpCommand: env.KNOWLEDGE_MCP_COMMAND ? env.KNOWLEDGE_MCP_COMMAND.split(/\s+/).filter(Boolean) : DEFAULT_MCP_COMMAND,
    knowledgeBundle: env.KNOWLEDGE_BUNDLE || '', // OKF bundle dir for the mock MCP server (default knowledge/okf)
    rateLimitPerMin: Number(env.RATE_LIMIT_PER_MIN || 30),
    maxBodyBytes: Number(env.MAX_BODY_BYTES || 64 * 1024),
    logContent: env.LOG_CONTENT === 'true', // off by default: questions may contain client data
    widgetDir: env.WIDGET_DIR || new URL('../../widget/dist/', import.meta.url).pathname,
    apps: loadApps(env.APP_REGISTRY),
  };
  if (cfg.elizaMode === 'http' && !cfg.elizaUrl) {
    throw new Error('ELIZA_URL is required when ELIZA_MODE=http (use ELIZA_MODE=mock for local dev)');
  }
  if (!['http', 'claude', 'mock'].includes(cfg.elizaMode)) {
    throw new Error(`Unknown ELIZA_MODE "${cfg.elizaMode}"`);
  }
  if (!['bearer', 'trusted-header', 'none'].includes(cfg.authMode)) {
    throw new Error(`Unknown AUTH_MODE "${cfg.authMode}"`);
  }
  return cfg;
}

// App registry: which applications may use the copilot and which knowledge namespaces
// each may search. Unknown appIds are rejected. Example in config/apps.example.json.
function loadApps(path) {
  if (!path) return null; // null = allow any appId (dev only)
  if (!existsSync(path)) throw new Error(`APP_REGISTRY file not found: ${path}`);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  return new Map(Object.entries(json.apps || {}));
}

function list(v) {
  return (v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
