#!/usr/bin/env node
// Mock knowledge MCP server over stdio (newline-delimited JSON-RPC 2.0), zero dependencies.
// Stands in for the real F&IS knowledge MCP server that Eliza calls. It serves an OKF bundle with
// three tools: search_concepts, get_concept, list_links.
//
//   node packages/knowledge-mcp/src/server.js [bundleDir]     (default: knowledge/okf, or $KNOWLEDGE_BUNDLE)
//
// Register it with any MCP client, e.g. { "command": "node", "args": ["…/server.js", "…/knowledge/okf"] }.
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { loadBundle } from './bundle.js';

const DEFAULT_BUNDLE = fileURLToPath(new URL('../../../knowledge/okf', import.meta.url));
const NAMESPACES = {
  type: 'array',
  items: { type: 'string' },
  description: 'Knowledge namespaces the caller may read, e.g. ["fund-accounting/eagle-star", "shared"].',
};

export const TOOLS = [
  {
    name: 'search_concepts',
    description:
      'Search the support knowledge base (runbooks, Confluence pages, JIRA known issues). Returns the best matching ' +
      'concepts with path, title, description, source and a snippet. Use get_concept to read one in full.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords: error codes, job names, screen names, JIRA keys.' },
        type: { type: 'string', enum: ['Runbook', 'ConfluencePage', 'JiraIssue'], description: 'Optional filter by concept type.' },
        limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Max results, default 5.' },
        namespaces: NAMESPACES,
      },
      required: ['query'],
    },
  },
  {
    name: 'get_concept',
    description: 'Read one knowledge concept in full (Markdown body, metadata and outgoing links) by its bundle path.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Bundle path from search results, e.g. /runbooks/nav-batch-failure.md' },
        namespaces: NAMESPACES,
      },
      required: ['path'],
    },
  },
  {
    name: 'list_links',
    description: 'List the concepts a concept links to (related runbooks, pages and issues).',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, namespaces: NAMESPACES },
      required: ['path'],
    },
  },
];

export function createHandler(bundle) {
  function callTool(name, args = {}) {
    const ns = Array.isArray(args.namespaces) ? args.namespaces : undefined;
    let result;
    if (name === 'search_concepts') {
      result = { results: bundle.search({ query: String(args.query || ''), namespaces: ns, type: args.type, limit: Number(args.limit) || 5 }) };
    } else if (name === 'get_concept') {
      result = bundle.get(args.path, ns);
      if (!result) return toolError(`No concept at ${args.path} (or not in an allowed namespace).`);
    } else if (name === 'list_links') {
      const links = bundle.links(args.path, ns);
      if (!links) return toolError(`No concept at ${args.path} (or not in an allowed namespace).`);
      result = { links };
    } else {
      return toolError(`Unknown tool ${name}`);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false };
  }

  return function handle(msg) {
    const { id, method, params = {} } = msg;
    if (id === undefined) return null; // notification (e.g. notifications/initialized)
    switch (method) {
      case 'initialize':
        return ok(id, {
          protocolVersion: params.protocolVersion || '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'fis-knowledge-mock', version: '0.1.0' },
          instructions: 'F&IS support knowledge (OKF bundle). Search first, then read the most relevant concepts.',
        });
      case 'ping':
        return ok(id, {});
      case 'tools/list':
        return ok(id, { tools: TOOLS });
      case 'tools/call':
        return ok(id, callTool(params.name, params.arguments));
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
  };
}

function ok(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function toolError(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || process.env.KNOWLEDGE_BUNDLE || DEFAULT_BUNDLE;
  const bundle = loadBundle(dir);
  const handle = createHandler(bundle);
  process.stderr.write(`fis-knowledge-mock: ${bundle.size} concepts from ${dir}\n`);
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let reply;
    try {
      reply = handle(JSON.parse(line));
    } catch {
      reply = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
    }
    if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`);
  });
}
