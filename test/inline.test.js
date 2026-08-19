import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, flatten } from '../src/inline.js';

/** Every inline node of a plain run, for terse assertions. */
const nodesOf = (text) => {
  const segs = parseInline(text, 0, text.length);
  return segs.flatMap((s) => (s.kind === 'inline' ? s.nodes : [{ type: `cm:${s.type}` }]));
};
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

/* --- interaction with tracked changes ------------------------------------ */

test('CriticMarkup is segmented before inline parsing', () => {
  const text = 'a {--gone--} b';
  const segs = parseInline(text, 0, text.length);
  assert.deepEqual(segs.map((s) => s.kind), ['inline', 'markup', 'inline']);
  assert.equal(segs[1].type, 'del');
});

test('formatting inside a tracked change is still formatting', () => {
  const text = '{--**bold gone**--}';
  const [seg] = parseInline(text, 0, text.length);
  assert.equal(seg.kind, 'markup');
  assert.equal(seg.body.nodes[0].type, 'strong');
  assert.equal(text.slice(seg.body.nodes[0].contentStart, seg.body.nodes[0].contentEnd), 'bold gone');
});

test('a substitution exposes both halves with offsets', () => {
  const text = '{~~old *word*~>new **word**~~}';
  const [seg] = parseInline(text, 0, text.length);
  assert.equal(text.slice(seg.old.start, seg.old.end), 'old *word*');
  assert.equal(text.slice(seg.next.start, seg.next.end), 'new **word**');
  assert.ok(seg.old.nodes.some((n) => n.type === 'em'));
  assert.ok(seg.next.nodes.some((n) => n.type === 'strong'));
});

test('emphasis never straddles an annotation boundary', () => {
  const text = '**start {--mid--} end**';
  const segs = parseInline(text, 0, text.length);
  assert.equal(segs.length, 3, 'split by the annotation, so no strong node spans it');
  assert.equal(segs.every((s) => !(s.nodes || []).some((n) => n.type === 'strong')), true);
});

/* --- offsets -------------------------------------------------------------- */

test('flattened text nodes reconstruct the visible text in order', () => {
  const text = 'a **b** and [c](u)';
  const segs = parseInline(text, 0, text.length);
  const visible = flatten(segs.flatMap((s) => s.nodes)).map((n) => text.slice(n.start, n.end)).join('');
  assert.equal(visible, 'a b and c');
});

test('offsets are absolute when parsing a sub-range', () => {
  const text = 'PREFIX **bold** SUFFIX';
  const segs = parseInline(text, 7, 15);
  const strong = segs[0].nodes[0];
  assert.equal(strong.type, 'strong');
  assert.equal(text.slice(strong.start, strong.end), '**bold**');
});
