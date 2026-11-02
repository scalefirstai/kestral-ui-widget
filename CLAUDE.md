# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is
Embeddable support copilot for BNY F&IS apps. `packages/widget` (browser JS, no runtime deps) → `packages/gateway`
(Node, no runtime deps) → Eliza (BNY's LLM/MCP orchestrator; external, not in this repo).

## Commands
- `npm test` — all unit tests (node:test). Run before every commit.
- `npm run build` — widget bundles to `packages/widget/dist/` (esbuild, ES2018 target).
- `npm run dev` — gateway on :8787 with `ELIZA_MODE=mock`.

## Rules
- Widget must stay dependency-free and ES2018-compatible: it runs in WebView2, Electron and older intranet Edge.
- Never set `innerHTML` from model or user text except through `renderMarkdown` (escapes first). Add a test for any new Markdown rule.
- All widget styles live in the Shadow DOM (`styles.js`). Never touch the host page's DOM outside the widget's host element.
- Protocol changes: update `docs/PROTOCOL.md`, the widget transport and the gateway together, with tests on both sides.
- Eliza wire-format changes go only in `packages/gateway/src/eliza.js`.
- Do not log question text unless `LOG_CONTENT=true`. No client data in test fixtures.
- Gateway stays thin: identity, app/namespace registration, rate limit, audit. Document-level ACLs belong to Eliza / the knowledge MCP server.

## Workflow
Design → plan → implement → test. For non-trivial changes, ask clarifying questions first, write the plan in the PR
description, and keep commits small.
