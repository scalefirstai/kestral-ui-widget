# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is
Embeddable support copilot for BNY F&IS apps. `packages/widget` (hosted browser JS, no runtime deps) → `packages/gateway`
(Node, no runtime deps except `@anthropic-ai/sdk`, loaded only in `ELIZA_MODE=claude`) → Eliza (BNY's LLM/MCP
orchestrator; external, not in this repo). `packages/knowledge-mcp` is a mock knowledge MCP server over the OKF bundle in
`knowledge/okf`; `ELIZA_MODE=claude` uses it with Claude as a local stand-in for Eliza.

## Commands
- `npm test` — all unit tests (node:test). Run before every commit.
- `npm run build` — widget bundles to `packages/widget/dist/` (esbuild, ES2018 target).
- `npm run dev` — gateway on :8787 with `ELIZA_MODE=mock`.
- `npm run dev:claude` — gateway on :8787 with Claude + mock knowledge MCP (needs `ANTHROPIC_API_KEY`).
- `npm run examples` — serves `examples/` on :5173 (a separate origin, like a real host app).

## Rules
- Widget must stay dependency-free and ES2018-compatible: it runs in WebView2, Electron and older intranet Edge.
- Never set `innerHTML` from model or user text except through `renderMarkdown` (escapes first). Add a test for any new Markdown rule.
- All widget styles live in the Shadow DOM (`styles.js`). Never touch the host page's DOM outside the widget's host element.
- Protocol changes: update `docs/PROTOCOL.md`, the widget transport and the gateway together, with tests on both sides.
- Eliza wire-format changes go only in `packages/gateway/src/eliza.js`. `claude.js` must keep consuming the same
  `buildElizaRequest` output so switching to Eliza stays a config change.
- The hosted bundle's public surface is `window.FisCopilot(command, arg)` + `FisCopilot.init`. Keep the loader snippet
  working: calls queued before load must replay in order (`commands.js`, tested).
- Every question carries context: `appMnemonic` (3-char app code, required at boot, checked against the registry),
  `screen`, `error` and custom keys. Widget `context.js` and gateway `context.js` must agree with `docs/PROTOCOL.md`.
- Knowledge docs are OKF: Markdown + YAML frontmatter with `type` required; `namespace` scopes access. Sample content
  is fictional; never add client data.
- Do not log question text unless `LOG_CONTENT=true`. No client data in test fixtures.
- Gateway stays thin: identity, app/namespace registration, rate limit, audit. Document-level ACLs belong to Eliza / the knowledge MCP server.

## Workflow
Design → plan → implement → test. For non-trivial changes, ask clarifying questions first, write the plan in the PR
description, and keep commits small.
