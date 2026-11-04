// All styles live inside the Shadow DOM, so host-page CSS (Bootstrap, Kendo, legacy
// ASP.NET themes) can't leak in and ours can't leak out.
export function buildStyles(theme) {
  const t = { accent: '#0b5cad', ...theme };
  return `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  --accent: ${t.accent};
  --bg: #ffffff; --fg: #1d232b; --muted: #5f6b7a; --line: #dde3ea;
  --bubble-user: var(--accent); --bubble-user-fg: #fff; --bubble-bot: #f2f5f8;
  font: 14px/1.45 "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif;
  color: var(--fg);
}
@media (prefers-color-scheme: dark) {
  .root:not([data-theme="light"]) {
    --bg: #1b1f24; --fg: #e8ecf1; --muted: #9aa6b4; --line: #2e353d; --bubble-bot: #262c33;
  }
}
.root[data-theme="dark"] {
  --bg: #1b1f24; --fg: #e8ecf1; --muted: #9aa6b4; --line: #2e353d; --bubble-bot: #262c33;
}
.launcher {
  position: fixed; z-index: 2147483000; width: 52px; height: 52px; border-radius: 50%;
  border: none; background: var(--accent); color: #fff; cursor: pointer;
  box-shadow: 0 4px 14px rgba(0,0,0,.25); display: grid; place-items: center;
}
.launcher:focus-visible, button:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.pos-br .launcher { right: 20px; bottom: 20px; } .pos-bl .launcher { left: 20px; bottom: 20px; }
.panel {
  position: fixed; z-index: 2147483001; width: min(400px, calc(100vw - 24px));
  height: min(600px, calc(100vh - 100px)); background: var(--bg); border: 1px solid var(--line);
  border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.25); display: none; flex-direction: column; overflow: hidden;
}
.pos-br .panel { right: 20px; bottom: 84px; } .pos-bl .panel { left: 20px; bottom: 84px; }
.root.open .panel { display: flex; }
.root.inline .launcher { display: none; }
.root.inline .panel { position: static; display: flex; width: 100%; height: 100%; box-shadow: none; }
header { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
header .title { font-weight: 600; flex: 1; }
header .sub { font-size: 12px; color: var(--muted); }
header .ctx { font-size: 11px; color: var(--muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 280px; }
header .ctx:empty { display: none; }
.icon-btn { background: none; border: none; color: var(--muted); cursor: pointer; padding: 4px; border-radius: 6px; font-size: 16px; }
.icon-btn:hover { color: var(--fg); background: var(--bubble-bot); }
.messages { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.msg { max-width: 88%; padding: 9px 12px; border-radius: 12px; word-wrap: break-word; }
.msg.user { align-self: flex-end; background: var(--bubble-user); color: var(--bubble-user-fg); white-space: pre-wrap; }
.msg.bot { align-self: flex-start; background: var(--bubble-bot); }
.msg.bot p { margin: 0 0 6px; } .msg.bot p:last-child { margin-bottom: 0; }
.msg.bot p.h { font-weight: 600; }
.msg.bot ul, .msg.bot ol { margin: 4px 0 6px; padding-left: 20px; }
.msg.bot code { font: 12px/1.4 Consolas, "Cascadia Mono", monospace; background: rgba(127,127,127,.15); padding: 1px 4px; border-radius: 4px; }
.msg.bot pre { margin: 6px 0; padding: 8px; overflow-x: auto; background: rgba(127,127,127,.15); border-radius: 6px; }
.msg.bot pre code { background: none; padding: 0; }
.msg.bot a { color: var(--accent); }
.msg.error { align-self: stretch; background: #fdecea; color: #8a1c13; font-size: 13px; }
.cites { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.cite { font-size: 12px; border: 1px solid var(--line); border-radius: 999px; padding: 2px 8px; color: var(--fg); text-decoration: none; background: var(--bg); }
.cite:hover { border-color: var(--accent); }
.fb { margin-top: 6px; display: flex; gap: 4px; }
.fb button { font-size: 12px; }
.fb button[aria-pressed="true"] { color: var(--accent); }
.typing { color: var(--muted); font-size: 13px; }
.suggestions { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 10px; }
.suggestions button { border: 1px solid var(--line); background: var(--bg); color: var(--fg); border-radius: 999px; padding: 4px 10px; cursor: pointer; font: inherit; font-size: 12px; }
form { display: flex; gap: 8px; padding: 10px; border-top: 1px solid var(--line); }
textarea { flex: 1; resize: none; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font: inherit; color: var(--fg); background: var(--bg); max-height: 120px; }
.send { background: var(--accent); color: #fff; border: none; border-radius: 8px; padding: 0 14px; cursor: pointer; font: inherit; font-weight: 600; }
.send[disabled] { opacity: .5; cursor: default; }
.foot { font-size: 11px; color: var(--muted); padding: 0 12px 8px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
`;
}
