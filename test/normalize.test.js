import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../src/edits.js';
import { transform } from '../src/criticmarkup.js';

const run = (text, caret = null) => normalize(text, caret);

test('deleting text and typing it back leaves no trace', () => {
  assert.equal(run('a {++word++}{--word--} b').text, 'a word b');
  assert.equal(run('a {--word--}{++word++} b').text, 'a word b');
});

test('typing back only part of what you deleted keeps the difference', () => {
  const r = run('a {++wor++}{--word--} b');
  assert.equal(transform(r.text, 'accepted'), 'a wor b');
  assert.equal(transform(r.text, 'rejected'), 'a word b');
  assert.equal(r.text.includes('word'), false, 'the shared prefix is plain text again');
});

test('typing more than you deleted keeps only the addition', () => {
  const r = run('a {++wordsmith++}{--word--} b');
  assert.equal(r.text, 'a word{++smith++} b');
  assert.equal(transform(r.text, 'accepted'), 'a wordsmith b');
  assert.equal(transform(r.text, 'rejected'), 'a word b');
});

test('a shared suffix cancels when one side contains the other', () => {
  const r = run('a {++ending++}{--pending--} b');
  assert.equal(transform(r.text, 'accepted'), 'a ending b');
  assert.equal(transform(r.text, 'rejected'), 'a pending b');
  assert.equal(r.text, 'a {--p--}ending b');
});

test('incidental overlap is left readable rather than shaved', () => {
  const text = 'a {--alpha--}{++beta++} b';
  assert.equal(run(text).text, text, 'alpha -> beta beats alph -> bet plus a stray a');
});

test('a substitution that changes nothing disappears', () => {
  assert.equal(run('a {~~same~>same~~} b').text, 'a same b');
});

test('a substitution keeps only the part that actually differs', () => {
  const r = run('the {~~stopgap~>stopgaps~~} loader');
  assert.equal(transform(r.text, 'accepted'), 'the stopgaps loader');
  assert.equal(transform(r.text, 'rejected'), 'the stopgap loader');
  assert.ok(r.text.includes('stopgap{++s++}'), 'shared text is no longer marked');
});

test('unrelated edits are left alone', () => {
  const text = 'a {--alpha--}{++beta++} b';
  assert.equal(run(text).text, text);
});

test('an explained edit is never dissolved', () => {
  const text = 'a {--word--}{>>too casual<<}{++word++} b';
  assert.equal(run(text).text, text, 'a reason is a deliberate act; keep it');
});

test('an explained substitution is left alone', () => {
  const text = 'a {~~same~>same~~}{>>deliberate<<} b';
  assert.equal(run(text).text, text);
});

test('normalisation never changes what the document means', () => {
  const cases = [
    'a {++word++}{--word--} b',
    'a {++wor++}{--word--} b',
    'a {++wordsmith++}{--word--} b',
    'the {~~stopgap~>stopgaps~~} loader',
    'a {--alpha--}{++beta++} b',
    'a {++ending++}{--pending--} b',
  ];
  for (const text of cases) {
    const r = run(text);
    assert.equal(transform(r.text, 'accepted'), transform(text, 'accepted'), `accepted: ${text}`);
    assert.equal(transform(r.text, 'rejected'), transform(text, 'rejected'), `rejected: ${text}`);
  }
});

test('the caret stays with the text it was next to', () => {
  const text = 'a {++word++}{--word--} b';
  const caret = { start: text.indexOf('++}'), end: text.indexOf('++}') };
  const r = run(text, caret);
  assert.equal(r.text, 'a word b');
  assert.equal(r.caret.start, 'a word'.length);
});

test('repeated passes settle rather than loop', () => {
  const r = run('{++ab++}{--abc--}{++c++}');
  assert.equal(transform(r.text, 'accepted'), transform('{++ab++}{--abc--}{++c++}', 'accepted'));
});
