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

/* --- runs, not just neighbouring pairs ------------------------------------ */

test('cancelling edits separated by another edit still cancel', () => {
  // Retyped "ry", added a paragraph break, then removed the old "ry" and the
  // old break. Four annotations whose net effect is nothing at all.
  const text = '## Summa{++ry++}{++\n\n++}{--ry--}{--\n\n--}This document';
  const r = run(text);
  assert.equal(r.text, '## Summary\n\nThis document');
});

test('a run that does change something keeps only the difference', () => {
  const text = 'a {++new++}{++ text++}{--old--} b';
  const r = run(text);
  assert.equal(transform(r.text, 'accepted'), 'a new text b');
  assert.equal(transform(r.text, 'rejected'), 'a old b');
});

test('a run is not collapsed across ordinary text', () => {
  const text = 'a {++x++} plain {--x--} b';
  assert.equal(run(text).text, text, 'these are two separate edits');
});

test('a highlight interrupts a run rather than dissolving into it', () => {
  const text = '{++x++}{==kept==}{--x--}';
  assert.equal(run(text).text, text);
});

test('an explained edit protects its whole run', () => {
  const text = '{++ry++}{++\n\n++}{--ry--}{>>deliberate<<}{--\n\n--}';
  const r = run(text);
  assert.ok(r.text.includes('{>>deliberate<<}'), 'the reason survives');
});

test('runs never change what the document means', () => {
  const cases = [
    '## Summa{++ry++}{++\n\n++}{--ry--}{--\n\n--}This document',
    'a {++new++}{++ text++}{--old--} b',
    'a {++x++} plain {--x--} b',
    '{++x++}{==kept==}{--x--}',
    'x {~~one~>two~~}{++ three++} y',
  ];
  for (const text of cases) {
    const r = run(text);
    assert.equal(transform(r.text, 'accepted'), transform(text, 'accepted'), `accepted: ${text}`);
    assert.equal(transform(r.text, 'rejected'), transform(text, 'rejected'), `rejected: ${text}`);
  }
});

/* --- where the caret ends up ---------------------------------------------- */

test('typing into a partly-cancelled edit leaves the caret after what you typed', () => {
  // "## Summ" with "ary" struck; caret between "Summ" and the strike; type "a".
  const text = '## Summ{++a++}{--ary--}\n\nThis document';
  const caret = { start: text.indexOf('++}'), end: text.indexOf('++}') };   // just after the typed "a"
  const r = normalize(text, caret);
  assert.equal(r.text, '## Summa{--ry--}\n\nThis document');
  assert.equal(r.text.slice(0, r.caret.start), '## Summa', 'caret sits right after the "a"');
});

test('the caret survives a whole run collapsing to nothing', () => {
  const text = '## Summa{++ry++}{++\n\n++}{--ry--}{--\n\n--}This document';
  const caret = { start: text.indexOf('++}{++'), end: text.indexOf('++}{++') };  // after the typed "ry"
  const r = normalize(text, caret);
  assert.equal(r.text, '## Summary\n\nThis document');
  assert.equal(r.text.slice(0, r.caret.start), '## Summary');
});

test('a caret before or after a rewrite is only shifted', () => {
  const text = 'head {++word++}{--word--} tail';
  const before = normalize(text, { start: 2, end: 2 });
  assert.equal(before.caret.start, 2);
  const after = normalize(text, { start: text.length, end: text.length });
  assert.equal(after.caret.start, after.text.length);
});

test('the caret never lands inside markup', () => {
  const text = '## Summ{++a++}{--ary--}\n\nThis document';
  for (let p = 0; p <= text.length; p++) {
    const r = normalize(text, { start: p, end: p });
    const region = r.text.slice(r.caret.start, r.caret.start + 3);
    assert.notEqual(region, '--}', `caret landed inside a delimiter from ${p}`);
  }
});
