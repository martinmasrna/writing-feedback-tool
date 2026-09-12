/**
 * A static server for development, so the browser will load ES modules
 * (module imports are blocked over file://). No dependencies, no watching —
 * the page is a reload away.
 */

import { createServer } from 'node:http';
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { homedir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 4173;

/**
 * Deep-link support: /open?path=<abs> serves a markdown file from the
 * safelisted roots below, so mission control can link straight into the
 * editor. /save?path=<abs> (PUT) writes back to the same file, under the
 * same safelist, so a document opened this way saves in place with no
 * dialog at all — the page never gets to choose an arbitrary path.
 */
const OPEN_ROOTS = [
  resolve(homedir(), 'Projects/company'),
  resolve(homedir(), 'Projects/Research'),
  resolve(homedir(), '.claude'),
];
const OPEN_EXTS = new Set(['.md', '.markdown', '.mdown', '.txt']);

/**
 * Resolve `path` and check it against the safelist, following symlinks first
 * (realpath, not resolve) so one inside a root can't point outside it. Also
 * doubles as the "does this file already exist" check /save relies on — a
 * path realpath can't resolve throws, and is treated as not found rather
 * than as a new file to create.
 */
async function safeTarget(path) {
  const target = await realpath(resolve(path || ''));
  const inRoots = OPEN_ROOTS.some((r) => target === r || target.startsWith(r + '/'));
  return inRoots && OPEN_EXTS.has(extname(target)) ? target : null;
}

/**
 * The file panel's two reads. /roots names the safelisted folders; /list
 * gives one folder's children — subfolders and openable files only, dotfiles
 * and node_modules left out — under the same safelist as /open, so the panel
 * can never show a path the editor could not then open.
 */
async function safeDir(path) {
  const target = await realpath(resolve(path || ''));
  const inRoots = OPEN_ROOTS.some((r) => target === r || target.startsWith(r + '/'));
  return inRoots ? target : null;
}
const HIDDEN = new Set(['node_modules', 'dist']);
/** Is there anything to open under this folder, within a few levels? A folder with nothing openable is noise in the panel. */
async function hasOpenable(dir, depth) {
  if (depth < 0) return false;
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return false; }
  const visible = entries.filter((e) => !e.name.startsWith('.') && !HIDDEN.has(e.name));
  if (visible.some((e) => e.isFile() && OPEN_EXTS.has(extname(e.name)))) return true;
  for (const e of visible) {
    if (e.isDirectory() && await hasOpenable(join(dir, e.name), depth - 1)) return true;
  }
  return false;
}
async function listDir(target) {
  const entries = await readdir(target, { withFileTypes: true });
  const kept = [];
  for (const e of entries) {
    if (e.name.startsWith('.') || HIDDEN.has(e.name)) continue;
    if (e.isDirectory()) {
      if (await hasOpenable(join(target, e.name), 3)) kept.push({ name: e.name, path: join(target, e.name), dir: true });
    } else if (OPEN_EXTS.has(extname(e.name))) {
      kept.push({ name: e.name, path: join(target, e.name), dir: false });
    }
  }
  return kept.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
}

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
    try {
      const target = await safeTarget(url.searchParams.get('path'));
      if (!target) { res.writeHead(403).end('forbidden'); return; }
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' })
        .end(await readFile(target));
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
    return;
  }
  if (url.pathname === '/roots') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify(OPEN_ROOTS.map((p) => ({ name: basename(p), path: p, dir: true }))));
    return;
  }
  if (url.pathname === '/list') {
    try {
      const target = await safeDir(url.searchParams.get('path'));
      if (!target) { res.writeHead(403).end('forbidden'); return; }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify(await listDir(target)));
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
    return;
  }
  if (url.pathname === '/save' && req.method === 'PUT') {
    try {
      const target = await safeTarget(url.searchParams.get('path'));
      if (!target) { res.writeHead(403).end('forbidden'); return; }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      await writeFile(target, Buffer.concat(chunks));
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
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
}).listen(port, '127.0.0.1', () => {
  console.log(`redline dev server  →  http://localhost:${port}/`);
});
