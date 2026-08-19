import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepCaret, insert, normalize } from '../src/edits.js';
import { transform } from '../src/criticmarkup.js';

/** Walk the caret and report where it lands, marked with a pipe. */
const at = (text, offset) => `${text.slice(0, offset)}|${text.slice(offset)}`;

test('plain text moves one character at a time', () => {
  const text = 'abc';
  assert.equal(stepCaret(text, 1, -1), 0);
  assert.equal(stepCaret(text, 1, 1), 2);
});

test('the caret stops at the ends of the document', () => {
  assert.equal(stepCaret('abc', 0, -1), 0);
  assert.equal(stepCaret('abc', 3, 1), 3);
});

test('one press steps over a whole deletion, not into it', () => {
  const text = 'Summ{--ary--} rest';
  const after = text.indexOf('--}') + 3;
  assert.equal(stepCaret(text, after, -1), text.indexOf('{--'));
  assert.equal(at(text, stepCaret(text, after, -1)), 'Summ|{--ary--} rest');
});

test('and steps over it going the other way', () => {
  const text = 'Summ{--ary--} rest';
  const before = text.indexOf('{--');
  assert.equal(stepCaret(text, before, 1), text.indexOf('--}') + 3);
});

test('a deletion carrying a reason is stepped over as one unit', () => {
  const text = 'Summ{--ary--}{>>too long<<} rest';
  const after = text.indexOf('<<}') + 3;
  assert.equal(at(text, stepCaret(text, after, -1)), 'Summ|{--ary--}{>>too long<<} rest');
});

test('the caret can still enter text you inserted yourself', () => {
  const text = 'Summ{++ary++} rest';
  const after = text.indexOf('++}') + 3;
  const landed = stepCaret(text, after, -1);
  assert.equal(at(text, landed), 'Summ{++ary|++} rest', 'inside the insertion, where typing continues');
});

test('a highlight is stepped over like a deletion', () => {
  const text = 'a {==kept==} b';
  const after = text.indexOf('==}') + 3;
  assert.equal(at(text, stepCaret(text, after, -1)), 'a |{==kept==} b');
});

test('consecutive annotations each take one press', () => {
  const text = 'A{--x--}\n{--y--}B';
  let p = text.length - 1;                       // just before B
  p = stepCaret(text, p, -1);
  assert.equal(at(text, p), 'A{--x--}\n|{--y--}B');
  p = stepCaret(text, p, -1);
  assert.equal(at(text, p), 'A{--x--}|\n{--y--}B');
  p = stepCaret(text, p, -1);
  assert.equal(at(text, p), 'A|{--x--}\n{--y--}B');
});

/* --- the reported case ---------------------------------------------------- */

test('arrowing back past a deletion and retyping restores the original', () => {
  // "## Summary" with "ary" deleted, then the blank line after it deleted too.
  let text = '## Summ{--ary--}\n{--\n--}This document\n';
  let caret = text.indexOf('This document');

  caret = stepCaret(text, caret, -1);            // over {--\n--}
  caret = stepCaret(text, caret, -1);            // over the real newline
  caret = stepCaret(text, caret, -1);            // over {--ary--}
  assert.equal(at(text, caret), '## Summ|{--ary--}\n{--\n--}This document\n');

  const typed = insert(text, { start: caret, end: caret }, 'ary');
  const settled = normalize(typed.text, typed.caret);
  assert.ok(settled.text.startsWith('## Summary'), 'the heading is whole again');
  assert.equal(settled.text.includes('{++'), false, 'and the edit cancelled itself out');
});

test('every landing spot is one the caret may legally occupy', () => {
  const text = 'a {--del--} b {++ins++} c {==hl==}{>>why<<} d';
  let p = 0;
  const seen = new Set();
  for (let i = 0; i < 100 && p < text.length; i++) {
    const next = stepCaret(text, p, 1);
    if (next === p) break;
    assert.ok(!seen.has(next), 'never revisits a position');
    seen.add(next);
    p = next;
  }
  assert.equal(p, text.length, 'walks all the way to the end');
});
