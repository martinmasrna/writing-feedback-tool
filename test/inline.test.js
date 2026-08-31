import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, flatten } from '../src/inline.js';

const nodesOf = (text) => parseInline(text, 0, text.length);
const types = (text) => nodesOf(text).map((n) => n.type);

test('plain text is one node', () => {
  assert.deepEqual(types('just words'), ['text']);
});

test('recognises the supported constructs', () => {
  assert.deepEqual(types('a **b** c'), ['text', 'strong', 'text']);
  assert.deepEqual(types('a *b* c'), ['text', 'em', 'text']);
  assert.deepEqual(types('a `b` c'), ['text', 'code', 'text']);
  assert.deepEqual(types('a [b](u) c'), ['text', 'link', 'text']);
});

test('bold wins over italic at the same position', () => {
  const [node] = nodesOf('**both**');
  assert.equal(node.type, 'strong');
  assert.equal('**both**'.slice(node.contentStart, node.contentEnd), 'both');
});

test('markers are real source ranges', () => {
  const text = 'a **b** c';
  const strong = nodesOf(text).find((n) => n.type === 'strong');
  assert.deepEqual(strong.markers.map(([s, e]) => text.slice(s, e)), ['**', '**']);
  assert.equal(text.slice(strong.contentStart, strong.contentEnd), 'b');
});

test('a link keeps its target and its label offsets', () => {
  const text = 'see [the docs](https://x.dev) now';
  const link = nodesOf(text).find((n) => n.type === 'link');
  assert.equal(link.href, 'https://x.dev');
  assert.equal(text.slice(link.contentStart, link.contentEnd), 'the docs');
});

test('nesting resolves inside emphasis', () => {
  const text = '**bold with *italic* inside**';
  const strong = nodesOf(text).find((n) => n.type === 'strong');
  assert.deepEqual(strong.children.map((c) => c.type), ['text', 'em', 'text']);
});

test('code spans are literal, not parsed for emphasis', () => {
  const text = 'use `a **b** c` here';
  const code = nodesOf(text).find((n) => n.type === 'code');
  assert.equal(text.slice(code.contentStart, code.contentEnd), 'a **b** c');
  assert.equal(types(text).filter((t) => t === 'strong').length, 0);
});

test('unmatched markers stay literal text', () => {
  assert.deepEqual(types('a ** b'), ['text']);
  assert.deepEqual(types('2 * 3 * 4'), ['text']);
});

/* --- offsets -------------------------------------------------------------- */

test('flattened text nodes reconstruct the visible text in order', () => {
  const text = 'a **b** and [c](u)';
  const visible = flatten(parseInline(text, 0, text.length)).map((n) => text.slice(n.start, n.end)).join('');
  assert.equal(visible, 'a b and c');
});

test('offsets are absolute when parsing a sub-range', () => {
  const text = 'PREFIX **bold** SUFFIX';
  const [strong] = parseInline(text, 7, 15);
  assert.equal(strong.type, 'strong');
  assert.equal(text.slice(strong.start, strong.end), '**bold**');
});

/* --- adversarial input ----------------------------------------------------- */

/**
 * The parser is handed whatever a document contains, and a document written by
 * an agent contains plenty of stray `*`, `_`, backticks and half-formed links.
 * Unrecognised syntax must stay literal text — unstyled prose beats mangled
 * markup — and no character may be dropped on the way.
 */
const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const PIECES = ['*', '**', '_', '__', '`', '[', ']', '(', ')', 'a', 'bc', ' ', 'word', 'https://x/y', '\n', '\\', '~'];

/** Is every character either drawn as text or claimed as syntax? */
function accountedFor(nodes, from, to) {
  const covered = new Array(to - from).fill(false);
  const walk = (list) => {
    for (const n of list) {
      if (n.type === 'text') { for (let i = n.start; i < n.end; i++) covered[i - from] = true; continue; }
      for (const [a, b] of n.markers || []) for (let i = a; i < b; i++) covered[i - from] = true;
      if (n.children) walk(n.children);
      else for (let i = n.contentStart; i < n.contentEnd; i++) covered[i - from] = true;
    }
  };
  walk(nodes);
  return covered.every(Boolean);
}

const failures = [];
for (let seed = 0; seed < 8000; seed++) {
  const rnd = mulberry32(seed * 2654435761 + 17);
  let text = '';
  const pieces = 1 + Math.floor(rnd() * 10);
  for (let i = 0; i < pieces; i++) text += PIECES[Math.floor(rnd() * PIECES.length)];

  let nodes;
  try { nodes = parseInline(text, 0, text.length); }
  catch (e) { failures.push([text, `threw ${e.message}`]); continue; }

  let cursor = 0;
  let broke = null;
  for (const node of nodes) {
    if (node.start !== cursor) { broke = `gap or overlap at ${cursor}`; break; }
    if (node.end > text.length || node.end < node.start) { broke = `range ${node.start}..${node.end} is not inside`; break; }
    cursor = node.end;
  }
  if (!broke && cursor !== text.length) broke = `nodes stop at ${cursor} of ${text.length}`;
  if (!broke && !accountedFor(nodes, 0, text.length)) broke = 'a character is neither text nor syntax';
  if (broke) failures.push([text, broke]);
}

test('8000 documents of stray markdown syntax parse without losing a character', () => {
  const report = failures.slice(0, 4).map(([t, why]) => `  ${JSON.stringify(t)} — ${why}`).join('\n');
  assert.equal(failures.length, 0, `${failures.length} inputs went wrong\n${report}`);
});
