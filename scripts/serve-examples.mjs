// Serves examples/ on http://localhost:5173 as a separate origin from the gateway (:8787), the same
// cross-origin setup as a real host app embedding the hosted script. Zero dependencies.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../examples/', import.meta.url));
const port = Number(process.env.PORT || 5173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

http
  .createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) return res.writeHead(403).end();
    try {
      const buf = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(buf);
    } catch {
      res.writeHead(404).end('Not found');
    }
  })
  .listen(port, () => console.log(`examples on http://localhost:${port}/web/`));
