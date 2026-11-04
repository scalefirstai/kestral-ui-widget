# Widget ⇄ Gateway protocol (v1)

The widget only ever talks to the gateway. The gateway is the only thing that talks to Eliza.
Any gateway that implements this contract (Node, .NET, Python) works with the widget.

## POST /v1/chat

Headers: `Content-Type: application/json`, `Accept: text/event-stream`,
`Authorization: Bearer <token>` (omitted when the host uses cookie / Windows auth).

```json
{
  "conversationId": "4b1d…",
  "appId": "eagle-star",
  "appMnemonic": "ESR",
  "namespace": "fund-accounting/eagle-star",
  "message": "Why did the NAV job fail for F12345?",
  "history": [{ "role": "user", "content": "…" }, { "role": "assistant", "content": "…" }],
  "context": {
    "appId": "eagle-star",
    "appMnemonic": "ESR",
    "screen": "NAV Dashboard",
    "route": "/nav/dashboard",
    "error": { "code": "ORA-00060", "message": "deadlock detected…", "jobName": "ES_NAV_ACCRUALS", "source": "host", "occurredAt": "2026-11-04T06:12:00Z" },
    "url": "…",
    "host": "webview2",
    "fundId": "F12345"
  },
  "client": { "version": "0.1.0", "host": "webview2" }
}
```

`host` is one of `web`, `webview2`, `electron`.

### Context

Sent with every question. The widget builds it; the gateway re-validates it.

| Key | Source | Notes |
| --- | --- | --- |
| `appMnemonic` | `appMnemonic` at boot (required) | 3-character BNY application code. The gateway checks it against `mnemonic` in the app registry: a mismatch is `403 mnemonic_mismatch`; if the widget omits it the registry value is used. |
| `appId` | `appId` at boot | Not overridable from context. |
| `screen` | `update({screen})` / `getContext()` / host bridge | Defaults to `document.title`. |
| `route`, `url`, `host` | host page / host bridge | |
| `error` | `FisCopilot('error', {...})`, `getContext()`, or captured automatically | `{ code, message, source, occurredAt, jobName?, severity?, correlationId? }` or `null`. Automatic capture keeps the latest uncaught error or unhandled rejection for 15 minutes (`captureErrors: false` to disable). |
| anything else | `update()` / `getContext()` | Passed through as `custom` (e.g. `fundId`, `valuationDate`). |

Precedence (lowest first): `context` at boot, captured page error, `update` / `error` commands, live `getContext()`.
Bounds on both sides: strings 500 chars, 40 keys, depth 3, functions dropped. The gateway logs `appMnemonic`, `screen`
and `error.code`, never the error message unless `LOG_CONTENT=true`.

Eliza receives the normalised context in `metadata.context` and a plain-text rendering in `metadata.contextSummary`.

### Streaming response (`text/event-stream`)

```
event: token
data: {"text":"Check the "}

event: citation
data: {"title":"Restart runbook","url":"https://confluence/…","source":"confluence"}

event: done
data: {"messageId":"m-123"}
```

On failure mid-stream: `event: error` with `{"code","message"}`. Keep-alive comments (`: keep-alive`) every 15s.

### Non-streaming (`?stream=false`)

For hosts behind proxies that buffer SSE:

```json
{ "text": "…", "citations": [{ "title": "…", "url": "…" }], "messageId": "m-123", "conversationId": "…" }
```

### Errors

JSON `{ "code", "message", "reqId" }` with status 400 (bad input), 401 (no identity), 403 (`unknown_app`, `namespace_denied`),
413, 429 (`rate_limited`), 5xx.

## POST /v1/feedback

```json
{ "conversationId": "…", "messageId": "m-123", "appId": "eagle-star", "rating": "up" }
```

Returns 202.

## Host bridge (desktop)

| Host | How the widget gets token / context |
| --- | --- |
| Web / ASP.NET | `getToken` / `getContext` in `init()`; or cookies + `AUTH_MODE=trusted-header` |
| WPF / WinForms (WebView2) | `chrome.webview.postMessage({type:'fis-copilot:request', id, method})` → host replies `PostWebMessageAsJson({type:'fis-copilot:response', id, result})` |
| Electron | `window.fisCopilotHost.getToken()` / `.getContext()` exposed from preload via `contextBridge` |

## Gateway → Eliza

Built in `packages/gateway/src/eliza.js` (`buildElizaRequest`, `httpEliza`). The endpoint path and event names there are
placeholders marked `ADAPT HERE`; map them to Eliza's real API.

Until Eliza is reachable, `ELIZA_MODE=claude` (`packages/gateway/src/claude.js`) takes the same `buildElizaRequest`
output and does Eliza's job locally: Claude with the knowledge MCP server's tools (`packages/knowledge-mcp`, serving the
OKF bundle in `knowledge/okf`). The gateway injects the app's registered namespaces into every tool call; the model
cannot choose them. Citations are the concepts the model read with `get_concept`. The user's token is forwarded on-behalf-of so Eliza
and the knowledge MCP server enforce document ACLs; the gateway only checks app and namespace registration.
