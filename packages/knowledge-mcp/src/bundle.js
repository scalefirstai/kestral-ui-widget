// Loads an Open Knowledge Format (OKF) bundle: a directory of Markdown concept files with YAML
// frontmatter (`type` required; `title`, `description`, `resource`, `tags`, `timestamp` recommended;
// extension keys preserved). `index.md` and `log.md` are reserved listings and are not concepts.
//
// Extension keys this bundle uses: `namespace` (which app's knowledge it is, used for access scoping),
// `source` (runbook | confluence | jira), plus source-specific keys such as `jira_key`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const RESERVED = new Set(['index.md', 'log.md']);
const STOPWORDS = new Set('a an and are as at be by can do does for from how i in is it my of on or the to what when why with'.split(' '));

export function loadBundle(root) {
  const concepts = [];
  for (const file of walk(root)) {
    const name = file.split(sep).pop();
    if (!name.endsWith('.md') || RESERVED.has(name)) continue;
    const { meta, body } = parseFrontmatter(readFileSync(file, 'utf8'));
    if (!meta.type) continue; // not an OKF concept
    const path = '/' + relative(root, file).split(sep).join('/');
    concepts.push({ path, meta, body, links: extractLinks(body), index: buildIndex(meta, body) });
  }
  return createBundle(concepts);
}

export function createBundle(concepts) {
  const byPath = new Map(concepts.map((c) => [c.path, c]));
  return {
    size: concepts.length,

    search({ query, namespaces, type, limit = 5 }) {
      const terms = tokenize(query);
      if (!terms.length) return [];
      return concepts
        .filter((c) => allowed(c, namespaces) && (!type || c.meta.type === type))
        .map((c) => ({ c, score: score(c, terms, query) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.min(Math.max(1, limit), 10))
        .map(({ c, score }) => ({ ...summary(c), score: Math.round(score * 100) / 100, snippet: snippet(c.body, terms) }));
    },

    get(path, namespaces) {
      const c = byPath.get(normalizePath(path));
      if (!c || !allowed(c, namespaces)) return null; // same answer for missing and forbidden
      return { ...summary(c), metadata: c.meta, links: c.links, content: c.body.trim() };
    },

    links(path, namespaces) {
      const c = byPath.get(normalizePath(path));
      if (!c || !allowed(c, namespaces)) return null;
      return c.links.map((l) => {
        const target = byPath.get(l.path);
        return { ...l, title: target && allowed(target, namespaces) ? target.meta.title : undefined };
      });
    },
  };
}

// A concept is visible if its namespace equals, or sits under, one of the allowed namespaces.
// No list means unrestricted (standalone use); the gateway always passes one.
export function allowed(c, namespaces) {
  if (!Array.isArray(namespaces)) return true;
  const ns = String(c.meta.namespace || 'shared');
  return namespaces.some((n) => ns === n || ns.startsWith(`${n}/`));
}

function summary(c) {
  const m = c.meta;
  return {
    path: c.path,
    type: m.type,
    title: m.title || c.path,
    description: m.description || '',
    resource: m.resource || '',
    source: m.source || '',
    namespace: m.namespace || 'shared',
    appMnemonic: m.app_mnemonic || '',
    tags: Array.isArray(m.tags) ? m.tags : [],
    timestamp: m.timestamp || '',
  };
}

function buildIndex(meta, body) {
  const tags = Array.isArray(meta.tags) ? meta.tags.join(' ') : '';
  return {
    title: tokenize(meta.title || ''),
    tags: tokenize(tags),
    description: tokenize(meta.description || ''),
    key: String(meta.jira_key || meta.runbook_id || '').toLowerCase(),
    body: tokenize(body),
  };
}

function score(c, terms, raw) {
  const idx = c.index;
  let s = 0;
  for (const t of terms) {
    s += 4 * count(idx.title, t) + 3 * count(idx.tags, t) + 2 * count(idx.description, t);
    s += Math.log1p(count(idx.body, t));
  }
  if (idx.key && raw.toLowerCase().includes(idx.key)) s += 20; // "FUND-1423", "RB-NAV-001"
  return s;
}

function count(tokens, t) {
  let n = 0;
  for (const x of tokens) if (x === t || (t.length > 3 && x.startsWith(t))) n++;
  return n;
}

export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function snippet(body, terms) {
  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('|'));
  const hit = lines.find((l) => terms.some((t) => l.toLowerCase().includes(t))) || lines[0] || '';
  return hit.length > 240 ? `${hit.slice(0, 237)}...` : hit;
}

function extractLinks(body) {
  const out = [];
  const re = /\[([^\]]+)\]\((\/[^)\s]+\.md)\)/g; // bundle-relative links only
  let m;
  while ((m = re.exec(body))) if (!out.some((l) => l.path === m[2])) out.push({ text: m[1], path: m[2] });
  return out;
}

function normalizePath(p) {
  const s = String(p || '').trim();
  return s.startsWith('/') ? s : `/${s}`;
}

// Minimal YAML frontmatter reader: `key: value`, `key: [a, b]` and `key:` followed by `- item` lines.
// Enough for OKF frontmatter; not a general YAML parser.
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  let listKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      meta[listKey].push(scalar(item[1]));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value === '') {
      meta[key] = [];
      listKey = key;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = value.slice(1, -1).split(',').map((v) => scalar(v.trim())).filter((v) => v !== '');
      listKey = null;
    } else {
      meta[key] = scalar(value);
      listKey = null;
    }
  }
  return { meta, body: m[2] };
}

function scalar(v) {
  const s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}
