// Minimal MCP client over stdio (newline-delimited JSON-RPC 2.0). Used only by the Claude stand-in
// (ELIZA_MODE=claude) to reach the knowledge MCP server; in production Eliza owns the MCP connection.
// The child process is started on first use and restarted on the next call if it exits.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const PROTOCOL_VERSION = '2025-06-18';

export function createStdioMcpClient({ command, args = [], env, timeoutMs = 15000, log = () => {} }) {
  let child = null;
  let ready = null;
  let seq = 0;
  const pending = new Map();

  function start() {
    child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...env } });
    const proc = child;
    createInterface({ input: proc.stdout }).on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`MCP ${msg.error.code}: ${msg.error.message}`));
      else p.resolve(msg.result);
    });
    proc.on('exit', (code) => {
      log({ event: 'mcp_exit', command, code });
      if (child === proc) {
        child = null;
        ready = null;
      }
      for (const [id, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error('MCP server exited'));
        pending.delete(id);
      }
    });
    proc.on('error', (err) => log({ event: 'mcp_error', command, message: err.message }));

    ready = request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'fis-copilot-gateway', version: '0.1.0' },
    }).then((info) => {
      notify('notifications/initialized');
      return info;
    });
    ready.catch(() => {});
    return ready;
  }

  function request(method, params) {
    return new Promise((resolve, reject) => {
      if (!child) return reject(new Error('MCP server not running'));
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP ${method} timed out`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  function notify(method, params) {
    if (child) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async function call(method, params) {
    await (ready || start());
    return request(method, params);
  }

  return {
    async listTools() {
      return (await call('tools/list', {})).tools || [];
    },
    callTool(name, args) {
      return call('tools/call', { name, arguments: args });
    },
    close() {
      if (child) child.kill();
      child = null;
      ready = null;
    },
  };
}
