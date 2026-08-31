import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toVisible, toSource, sliceSpans, commentsIn } from '../src/visible.js';

test('plain text passes through unchanged and maps one to one', () => {
  const v = toVisible('hello');
  assert.equal(v.text, 'hello');
  assert.equal(toSource(v, 3), 3);
});

test('delimiters leave the visible text but both halves stay', () => {
  const v = toVisible('a {--gone--} b {++added++} c');
  assert.equal(v.text, 'a gone b added c');
});

test('a substitution shows the old text then the new', () => {
  const v = toVisible('It {~~completely~>largely~~} works');
  assert.equal(v.text, 'It completelylargely works');
  const kinds = v.spans.map((s) => s.kind);
  assert.deepEqual(kinds, ['del', 'ins']);
});

test('every visible character maps back to the character it came from', () => {
  const source = 'a {--gone--} b {++added++} c';
  const v = toVisible(source);
  for (let i = 0; i < v.text.length; i++) {
    assert.equal(source.charAt(toSource(v, i)), v.text.charAt(i), `at ${i}`);
  }
});

test('a caret at the end maps to the end of the source', () => {
  const source = 'abc{++d++}';
  const v = toVisible(source);
  assert.equal(toSource(v, v.text.length), source.length);
});

test('comments leave the flow and remember what they explain', () => {
  const v = toVisible('a {--gone--}{>>why<<} b');
  assert.equal(v.text, 'a gone b');
  assert.equal(v.comments.length, 1);
  assert.equal(v.comments[0].text, 'why');
  assert.equal(v.comments[0].orphan, false);
});

test('a comment with no edit before it is an orphan', () => {
  const v = toVisible('some prose {>>general note<<}');
  assert.equal(v.text, 'some prose ');
  assert.equal(v.comments[0].orphan, true);
});

/* --- the bugs this module exists to fix ---------------------------------- */

test('a change spanning a line break yields real lines, not stray delimiters', () => {
  const v = toVisible('- Observability{++\n- ++}, queryable');
  assert.equal(v.text, '- Observability\n- , queryable');
  assert.equal(v.text.includes('{++'), false);
  assert.equal(v.text.split('\n').length, 2);
});

test('an edit inside emphasis leaves the emphasis intact', () => {
  const v = toVisible('a *new source {~~format~>shape~~}* here');
  assert.equal(v.text, 'a *new source formatshape* here');
  assert.equal(v.text.includes('{~~'), false, 'markdown now sees a matched pair');
});

test('an edit inside a code span leaves the span intact', () => {
  const v = toVisible('use `document{++_id++}` now');
  assert.equal(v.text, 'use `document_id` now');
});

/* --- spans ---------------------------------------------------------------- */

test('sliceSpans cuts a range at every change boundary', () => {
  const v = toVisible('one {--two--} three');
  const pieces = sliceSpans(v, 0, v.text.length).map((p) => [v.text.slice(p.start, p.end), p.kind]);
  assert.deepEqual(pieces, [['one ', null], ['two', 'del'], [' three', null]]);
});

test('sliceSpans over untouched text is one piece', () => {
  const v = toVisible('nothing tracked here');
  assert.deepEqual(sliceSpans(v, 0, v.text.length).map((p) => p.kind), [null]);
});

test('sliceSpans handles a substitution as two adjacent pieces', () => {
  const v = toVisible('It {~~old~>new~~} works');
  const pieces = sliceSpans(v, 0, v.text.length).map((p) => [v.text.slice(p.start, p.end), p.kind]);
  assert.deepEqual(pieces, [['It ', null], ['old', 'del'], ['new', 'ins'], [' works', null]]);
});

test('commentsIn finds the comments anchored in a range', () => {
  const v = toVisible('a {--x--}{>>first<<} b {--y--}{>>second<<}');
  assert.deepEqual(commentsIn(v, 0, 4).map((c) => c.text), ['first']);
  assert.equal(commentsIn(v, 0, v.text.length).length, 2);
});
