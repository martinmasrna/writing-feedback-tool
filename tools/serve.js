/**
 * A static server for development, so the browser will load ES modules
 * (module imports are blocked over file://). No dependencies, no watching —
 * the page is a reload away.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { homedir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 4173;

/**
 * Deep-link support: /open?path=<abs> serves a markdown file from the
 * safelisted roots below, so mission control can link straight into the
 * editor. Read-only — saving still goes through the picker in the page.
 */
const OPEN_ROOTS = [
  resolve(homedir(), 'Projects/Personal Brand'),
  resolve(homedir(), '.claude/knowledge'),
];
const OPEN_EXTS = new Set(['.md', '.markdown', '.mdown', '.txt']);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname === '/open') {
    const target = resolve(url.searchParams.get('path') || '');
    const inRoots = OPEN_ROOTS.some((r) => target === r || target.startsWith(r + '/'));
    if (!inRoots || !OPEN_EXTS.has(extname(target))) { res.writeHead(403).end('forbidden'); return; }
    try {
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' })
        .end(await readFile(target));
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
    return;
  }
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const path = join(root, rel === '/' ? 'index.html' : rel);
  if (!path.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
  try {
    const body = await readFile(path);
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] || 'application/octet-stream',
      'cache-control': 'no-store',
    }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}).listen(port, () => {
  console.log(`redline dev server  →  http://localhost:${port}/`);
});
