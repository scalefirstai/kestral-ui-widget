# F&IS Support Copilot

An embeddable production-support assistant any Fund & Investor Services application can install.
One pure-JavaScript widget runs in web apps, ASP.NET apps and .NET/Electron desktop apps, and talks to a thin
gateway that forwards to **Eliza**. Eliza owns the LLM, the MCP tool loop and retrieval over Confluence, JIRA,
runbooks and FAQs.

```
 Web app / ASP.NET page ─┐
 WPF/WinForms (WebView2) ─┼─ fis-copilot.js ──HTTPS/SSE──▶ Gateway ──▶ Eliza ──▶ knowledge MCP server
 Electron app ───────────┘   (Shadow DOM, no deps)          auth, CORS,         (Confluence, JIRA,
                                                            app registry,        runbooks, FAQs)
                                                            rate limit, audit
```

## What's in the repo

| Path | What it is |
| --- | --- |
| `packages/widget` | The widget. Plain JS, zero runtime dependencies, Shadow DOM, streaming, safe Markdown, WebView2 + Electron host bridges. Builds to an IIFE (`<script>`) and an ES module (npm). |
| `packages/gateway` | Reference gateway (Node ≥ 20, zero dependencies). `/v1/chat` (SSE or JSON), `/v1/feedback`, serves the widget bundle. Mock Eliza for local dev and CI. |
| `examples/` | Host integrations: plain web page, ASP.NET `_Layout.cshtml`, WPF WebView2 pane, Electron main/preload, React wrapper. |
| `docs/PROTOCOL.md` | Widget ⇄ gateway contract and the desktop host bridge. |
| `config/apps.example.json` | App registry: which apps may use the copilot and which knowledge namespaces each may search. |

## Run it locally

```bash
npm install
npm test          # widget + gateway tests
npm run dev       # builds the widget, starts the gateway on :8787 with mock Eliza
```

Then open `examples/web/index.html` in a browser (serve it, e.g. `npx serve examples/web`, and add that origin to
`ALLOWED_ORIGINS`).

## Embedding

**Any web page (incl. legacy ASP.NET WebForms):**

```html
<script src="https://copilot-gw.fis.internal/widget/fis-copilot.js"
        data-gateway-url="https://copilot-gw.fis.internal"
        data-app-id="eagle-star"
        data-namespace="fund-accounting/eagle-star" defer></script>
```

**Programmatic (token + screen context):**

```js
FisCopilot.init({
  gatewayUrl: 'https://copilot-gw.fis.internal',
  appId: 'eagle-star',
  namespace: 'fund-accounting/eagle-star',
  getToken: async () => myAuth.getAccessToken(),
  getContext: () => ({ screen: 'NAV Dashboard', fundId: 'F12345' }),
});
```

**Desktop:** see `examples/wpf-webview2` and `examples/electron`. The widget detects the host and asks it for the
token and context, so the desktop app keeps its own sign-in.

Options: `title`, `subtitle`, `placeholder`, `footer`, `position` (`bottom-right`/`bottom-left`), `container`
(render inline in a pane), `colorScheme`, `theme.accent`, `stream`, `suggestions`, `maxHistory`, `onEvent`.
API returned by `init`: `open()`, `close()`, `ask(text)`, `reset()`, `destroy()`.

## Gateway configuration

Environment variables, see `.env.example`. The important ones:

- `ELIZA_MODE` `http` | `mock`, `ELIZA_URL`, `ELIZA_API_KEY`
- `AUTH_MODE` `bearer` (token from the widget) | `trusted-header` (behind IIS / Windows auth) | `none` (dev only)
- `ALLOWED_ORIGINS` exact origins of the host apps, including desktop virtual hosts like `https://copilot.desktop`
- `APP_REGISTRY` path to the app registry JSON; unknown apps are rejected
- `LOG_CONTENT` `false` by default: questions can contain client data, so only lengths are logged

## Before production

- [ ] Map `packages/gateway/src/eliza.js` (`ADAPT HERE`) to Eliza's real endpoint and event names.
- [ ] Replace `defaultVerify` in `auth.js` with JWT signature verification against the IdP's JWKS, or confirm Eliza rejects bad tokens.
- [ ] Swap the in-memory rate limiter for a shared one if the gateway runs on more than one pod.
- [ ] Host the widget bundle on the gateway or an internal CDN with a pinned version.
- [ ] Accessibility review (keyboard, screen reader) on each host type.
- [ ] Security review of CSP on host pages: allow the gateway in `script-src` and `connect-src`.
