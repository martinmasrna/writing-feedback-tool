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
