import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parse, tokenize, transform, regionAt, overlapping, plainRun,
  markup, sanitize, hasReason, originalOf,
} from '../src/criticmarkup.js';

test('parses each construct', () => {
  const anns = parse('a {++x++} b {--y--} c {~~o~>n~~} d {==h==} e {>>note<<}');
  assert.deepEqual(anns.map((a) => a.type), ['ins', 'del', 'sub', 'hl', 'com']);
  assert.equal(anns[2].a, 'o');
  assert.equal(anns[2].b, 'n');
});

test('a following comment becomes the edit reason', () => {
  const [a] = parse('x {--gone--}{>>why<<} y');
  assert.equal(a.type, 'del');
  assert.equal(a.reason, 'why');
  assert.ok(hasReason(a));
  assert.equal(a.end - a.start, '{--gone--}{>>why<<}'.length);
});

test('a comment with no edit before it stands alone', () => {
  const [a] = parse('some prose {>>general note<<}');
  assert.equal(a.type, 'com');
  assert.equal(a.reason, 'general note');
});

test('an edit with no comment has no reason', () => {
  const [a] = parse('x {--gone--} y');
  assert.equal(a.reason, null);
  assert.equal(hasReason(a), false);
});

test('offsets cover the source exactly, in order', () => {
  const text = 'a {++x++} b {--y--} c';
  let pos = 0, covered = '';
  for (const t of tokenize(text)) {
    assert.equal(t.start, pos);
    covered += text.slice(t.start, t.end);
    pos = t.end;
  }
  assert.equal(pos, text.length);
  assert.equal(covered, text);
});

test('accepted and rejected previews', () => {
  const text = 'The {~~old~>new~~}{>>why<<} and {++added++} and {--cut--} and {==kept==}.';
  assert.equal(transform(text, 'accepted'), 'The new and added and  and kept.');
  assert.equal(transform(text, 'rejected'), 'The old and  and cut and kept.');
});

test('rejecting restores the original document', () => {
  const original = 'One two three four.';
  const annotated = 'One {~~two~>2~~}{>>n<<} {--three--} four{++!++}.';
  assert.equal(transform(annotated, 'rejected'), original.replace('three four', 'three four'));
});

test('regionAt distinguishes typeable bodies from finished markup', () => {
  const text = 'a {++xy++} b {--z--} c';
  const anns = parse(text);
  const ins = anns[0];
  assert.equal(regionAt(anns, ins.tok.start + 3).kind, 'insBody');
  assert.equal(regionAt(anns, ins.tok.start + 4).kind, 'insBody');
  assert.equal(regionAt(anns, ins.tok.start + 1).kind, 'atomic');
  assert.equal(regionAt(anns, anns[1].start + 4).kind, 'atomic');
  assert.equal(regionAt(anns, 0).kind, 'plain');
});

test('substitution replacement half is typeable, original half is not', () => {
  const anns = parse('{~~old~>new~~}');
  const a = anns[0];
  assert.equal(regionAt(anns, 3).kind, 'atomic');          // inside "old"
  assert.equal(regionAt(anns, a.tok.end - 4).kind, 'subNew'); // inside "new"
});

test('overlap detection allows adjacency but not intersection', () => {
  const anns = parse('aa {--bb--} cc');
  const a = anns[0];
  assert.equal(overlapping(anns, 0, a.start), null, 'ends where the annotation starts');
  assert.equal(overlapping(anns, a.end, a.end + 3), null, 'starts where it ends');
  assert.ok(overlapping(anns, 0, a.start + 4), 'crosses the opening boundary');
  assert.ok(overlapping(anns, a.start + 4, a.end + 2), 'crosses the closing boundary');
  assert.ok(overlapping(anns, 0, a.end + 2), 'swallows it whole');
  assert.ok(overlapping(anns, a.start + 4, a.start + 5), 'sits inside it');
});

test('plainRun is bounded by the neighbouring annotations', () => {
  const text = 'aa {--bb--} cc {--dd--} ee';
  const anns = parse(text);
  const [lo, hi] = plainRun(anns, 13);
  assert.equal(text.slice(lo, hi), ' cc ');
});

test('sanitize strips delimiters that would corrupt the markup', () => {
  assert.equal(sanitize('a {++b++} c'), 'a b c');
  assert.equal(sanitize('x ~> y'), 'x  y');
  assert.equal(sanitize('plain -- text'), 'plain -- text');
});

test('markup writes the documented syntax', () => {
  assert.equal(markup('sub', 'old', 'new', 'why'), '{~~old~>new~~}{>>why<<}');
  assert.equal(markup('del', 'old', '', 'why'), '{--old--}{>>why<<}');
  assert.equal(markup('hl', 'text', '', 'note'), '{==text==}{>>note<<}');
  assert.equal(markup('ins', '', 'text', 'why'), '{++text++}{>>why<<}');
});

test('an empty reason writes no comment at all', () => {
  assert.equal(markup('del', 'old', '', '   '), '{--old--}');
});

test('originalOf drives clean removal', () => {
  const [ins, del, sub, hl] = parse('{++a++} {--b--} {~~c~>d~~} {==e==}');
  assert.equal(originalOf(ins), '');
  assert.equal(originalOf(del), 'b');
  assert.equal(originalOf(sub), 'c');
  assert.equal(originalOf(hl), 'e');
});

test('round-trips a document containing every construct', () => {
  const text = [
    '# Title', '',
    'A {~~stopgap~>shim~~}{>>jargon<<} written in 2024.',
    'It {--completely--}{>>unsupported<<} rewrites it.',
    'The {==forty minutes==}{>>source?<<} figure.',
    'Add: {++see the postmortem++}{>>needs a link<<}',
    'Bare {--clause--} stays flagged.',
    'Floating. {>>tighten this<<}', '',
  ].join('\n');
  let rebuilt = '', pos = 0;
  for (const a of parse(text)) {
    rebuilt += text.slice(pos, a.start) + text.slice(a.start, a.end);
    pos = a.end;
  }
  rebuilt += text.slice(pos);
  assert.equal(rebuilt, text);
  assert.equal(parse(text).length, 6);
});
