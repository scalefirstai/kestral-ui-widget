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
  "namespace": "fund-accounting/eagle-star",
  "message": "Why did the NAV job fail for F12345?",
  "history": [{ "role": "user", "content": "…" }, { "role": "assistant", "content": "…" }],
  "context": { "url": "…", "host": "webview2", "screen": "NAV Dashboard", "fundId": "F12345" },
  "client": { "version": "0.1.0", "host": "webview2" }
}
```

`host` is one of `web`, `webview2`, `electron`.

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
placeholders marked `ADAPT HERE`; map them to Eliza's real API. The user's token is forwarded on-behalf-of so Eliza
and the knowledge MCP server enforce document ACLs; the gateway only checks app and namespace registration.
