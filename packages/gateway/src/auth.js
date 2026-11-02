// Identifies the caller. The gateway does NOT decide entitlements to documents itself:
// it forwards the user's identity/token to Eliza, and Eliza's knowledge MCP server applies
// row-level / namespace ACLs. The gateway only makes sure there IS an identity.
//
// Modes:
//  bearer          Authorization: Bearer <token> from the widget (web SPA, Electron, WebView2 host).
//                  Validate it here (verifyToken hook) or let Eliza reject it.
//  trusted-header  Gateway sits behind IIS / reverse proxy doing Windows-integrated auth (common for
//                  ASP.NET intranet apps). The proxy sets X-Forwarded-User; never expose the gateway
//                  directly in this mode.
//  none            Local development only.

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.status = 401;
    this.code = 'unauthenticated';
  }
}

export function authenticate(req, cfg, verifyToken = defaultVerify) {
  if (cfg.authMode === 'none') return { userId: 'dev-user', token: null };

  if (cfg.authMode === 'trusted-header') {
    const user = req.headers[cfg.trustedUserHeader];
    if (!user) throw new AuthError('Missing authenticated user from proxy');
    return { userId: String(user), token: null };
  }

  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new AuthError('Missing bearer token');
  const claims = verifyToken(m[1]);
  return { userId: claims.sub || 'unknown', token: m[1] };
}

// Placeholder: decodes a JWT payload WITHOUT verifying the signature so the user id can be
// logged and rate-limited. Replace with real verification (JWKS from BNY's IdP) before prod,
// or rely on Eliza to reject invalid tokens and treat this as best-effort.
function defaultVerify(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return { sub: 'opaque-token' };
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return { sub: 'opaque-token' };
  }
}
