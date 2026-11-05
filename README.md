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
| `packages/gateway` | Reference gateway (Node ≥ 20). `/v1/chat` (SSE or JSON), `/v1/feedback`, serves the widget bundle. Backends: `http` (Eliza, placeholder contract), `claude` (local stand-in), `mock`. |
| `packages/knowledge-mcp` | Mock knowledge MCP server (stdio, zero dependencies) with `search_concepts`, `get_concept`, `list_links`, scoped by namespace. |
| `db/oracle` | Oracle data model for chat sessions and long-term memory: tables, `cplt_chat_api` package, optional 23ai vector recall, tests. See `db/oracle/README.md`. |
| `knowledge/okf` | Sample Open Knowledge Format bundle: runbooks, Confluence pages and JIRA issues as Markdown + YAML frontmatter. Fictional content. |
| `examples/` | Host integrations: plain web page, ASP.NET `_Layout.cshtml`, WPF WebView2 pane, Electron main/preload, React wrapper. |
| `docs/PROTOCOL.md` | Widget ⇄ gateway contract and the desktop host bridge. |
| `config/apps.example.json` | App registry: which apps may use the copilot and which knowledge namespaces each may search. |

## Run it locally

```bash
npm install
npm test             # widget + gateway + knowledge MCP tests
npm run dev:claude   # gateway on :8787: Claude + mock knowledge MCP (needs ANTHROPIC_API_KEY, or put it in .env)
npm run dev          # same, with canned mock answers instead of Claude
npm run examples     # demo host app on http://localhost:5173/web/ (separate origin, like a real app)
```

### Backends

| `ELIZA_MODE` | What answers | Use |
| --- | --- | --- |
| `http` | Eliza over its API (`packages/gateway/src/eliza.js`, **placeholder**: map the endpoint, auth and event names at `ADAPT HERE`) | UAT / production |
| `claude` | Claude (`CLAUDE_MODEL`, default `claude-opus-5-5`) running the knowledge MCP tool loop, i.e. what Eliza will do | local dev and demos until Eliza is reachable |
| `mock` | Canned answer | tests, CI, UI work |

All three take the same request (`buildElizaRequest`) and yield the same events, so moving to Eliza is a config change.
The gateway injects the app's registered namespaces into every knowledge tool call; the model cannot widen them.

### Knowledge (OKF)

Each document is one Markdown file with OKF frontmatter (`type` required; `title`, `description`, `resource`, `tags`,
`timestamp`) plus extension keys `namespace` (access scope) and `source` (`runbook` | `confluence` | `jira`).
`resource` is the link shown to users as the citation. To add content, drop a file into `knowledge/okf/<folder>/`.

## Embedding

**Loader snippet (recommended, Intercom-style).** Paste once into the page `<head>`; it loads the script async and
queues calls made before it arrives:

```html
<script>
  (function (w, d, s, u) {
    w.FisCopilot = w.FisCopilot || function () { (w.FisCopilot.q = w.FisCopilot.q || []).push(arguments); };
    var j = d.createElement(s); j.async = true; j.src = u; d.head.appendChild(j);
  })(window, document, 'script', 'https://copilot-gw.fis.internal/widget/fis-copilot.js');

  FisCopilot('boot', {
    gatewayUrl: 'https://copilot-gw.fis.internal',
    appId: 'eagle-star',
    appMnemonic: 'ESR',                     // 3-character application code, required
    namespace: 'fund-accounting/eagle-star',
    getToken: async () => myAuth.getAccessToken(),
    getContext: () => ({ screen: 'NAV Dashboard', fundId: 'F12345' }),
  });

  // When the user is looking at an error, tell the copilot (null clears it):
  FisCopilot('error', { code: 'ORA-00060', message: 'deadlock detected', jobName: 'ES_NAV_ACCRUALS' });
</script>
```

Commands: `boot`, `update` (merge screen context, e.g. on route change), `error` (the error on screen), `open`,
`close`, `ask`, `reset`, `shutdown` (on sign-out).

**Context sent with every question:** app mnemonic, app id, screen (defaults to the page title), route, the error on
screen, plus any custom keys. Uncaught errors and unhandled promise rejections on the host page are captured
automatically. The panel header shows what will be sent (e.g. `Context: ESR · NAV Dashboard · ⚠ ORA-00060`). Full
schema in `docs/PROTOCOL.md`.

Per host:

| Host | How | Example |
| --- | --- | --- |
| Plain HTML / legacy intranet | snippet, or one `<script data-*>` tag | `examples/web/` |
| ASP.NET MVC / Razor / Blazor Server / WebForms | snippet in `_Layout.cshtml` / master page | `examples/aspnet/` |
| Angular | snippet in `index.html` + a 30-line service syncing the router | `examples/angular/` |
| React | snippet + `useSupportCopilot` hook, or the npm ES module | `examples/npm-react/` |
| WPF / WinForms (WebView2) | host page in WebView2; token/context over `postMessage` | `examples/wpf-webview2/` |
| Electron | snippet in the renderer; token/context from preload | `examples/electron/` |

The bundle is about 17 KB (7 KB gzipped), has no dependencies, renders in a Shadow DOM so host CSS can't leak in or
out, and targets ES2018.

**Zero-code tag (no script block allowed):**

```html
<script src="https://copilot-gw.fis.internal/widget/fis-copilot.js"
        data-gateway-url="https://copilot-gw.fis.internal"
        data-app-id="eagle-star"
        data-app-mnemonic="ESR"
        data-namespace="fund-accounting/eagle-star" defer></script>
```

**Programmatic (token + screen context):**

```js
FisCopilot.init({
  gatewayUrl: 'https://copilot-gw.fis.internal',
  appId: 'eagle-star',
  appMnemonic: 'ESR',
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

- `ELIZA_MODE` `http` | `claude` | `mock`, `ELIZA_URL`, `ELIZA_API_KEY`
- `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `CLAUDE_EFFORT`, `KNOWLEDGE_MCP_COMMAND`, `KNOWLEDGE_BUNDLE` (`claude` mode only)
- `AUTH_MODE` `bearer` (token from the widget) | `trusted-header` (behind IIS / Windows auth) | `none` (dev only)
- `ALLOWED_ORIGINS` exact origins of the host apps, including desktop virtual hosts like `https://copilot.desktop`
- `APP_REGISTRY` path to the app registry JSON; unknown apps are rejected
- `LOG_CONTENT` `false` by default: questions can contain client data, so only lengths are logged

## Before production

- [ ] Map `packages/gateway/src/eliza.js` (`ADAPT HERE`) to Eliza's real endpoint and event names, then set `ELIZA_MODE=http`.
- [ ] Register the real knowledge MCP server in Eliza and convert Confluence/JIRA/runbooks to OKF with `namespace` set.
- [ ] Replace `defaultVerify` in `auth.js` with JWT signature verification against the IdP's JWKS, or confirm Eliza rejects bad tokens.
- [ ] Swap the in-memory rate limiter for a shared one if the gateway runs on more than one pod.
- [ ] Host the widget bundle on the gateway or an internal CDN with a pinned version.
- [ ] Accessibility review (keyboard, screen reader) on each host type.
- [ ] Security review of CSP on host pages: allow the gateway in `script-src` and `connect-src`.
