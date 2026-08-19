import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editor, assertReversible } from './harness.js';

test('the harness drives the real editor', () => {
  const ed = editor('Hello world.\n').caretAfter('Hello').type(' there');
  assert.equal(ed.source, 'Hello{++ there++} world.\n');
  assert.equal(ed.accepted, 'Hello there world.\n');
  assert.equal(ed.rejected, 'Hello world.\n');
});

test('a realistic editing session stays reversible', () => {
  const original = '## Summary\n\nThe loader is a stopgap that completely rewrites things.\n';
  const ed = editor(original);
  ed.select('completely').type('largely');
  ed.caretAfter('stopgap').type(' (for now)');
  ed.select('Summary').type('Overview');
  assertReversible(assert, ed, original);
  assert.equal(ed.accepted, '## Overview\n\nThe loader is a stopgap (for now) that largely rewrites things.\n');
});

test('Enter opens one blank line per press', () => {
  const ed = editor('## Heading\n\nBody text.\n').caretBefore('Body');
  ed.press('Enter', 3);
  assert.equal(ed.accepted, '## Heading\n\n\n\n\nBody text.\n');
  assertReversible(assert, ed, '## Heading\n\nBody text.\n');
});

test('backspace at the top of a block joins it to the one above', () => {
  const ed = editor('## Heading\n\nBody text.\n').caretBefore('Body').press('Backspace');
  assert.equal(ed.accepted, '## HeadingBody text.\n');
  assertReversible(assert, ed, '## Heading\n\nBody text.\n');
});

test('deleting a word and typing it back leaves nothing behind', () => {
  const ed = editor('## Summary\n\nBody.\n');
  ed.select('ary').press('Backspace');
  assert.equal(ed.marked, '## Summ|{--ary--}\n\nBody.\n', 'caret waits where the text was');
  ed.type('ary');
  assert.equal(ed.source, '## Summary\n\nBody.\n', 'no annotation survives');
});

test('an arrow left then right returns to where it started', () => {
  const ed = editor('## Summary\n\nBody.\n').caretBefore('Body');
  const before = ed.caret.start;
  ed.press('ArrowLeft').press('ArrowRight');
  assert.equal(ed.caret.start, before);
});

test('the caret steps over a deletion in one press', () => {
  const ed = editor('## Summary\n\nBody.\n').select('ary').press('Backspace');
  ed.press('ArrowLeft');
  assert.equal(ed.marked, '## Sum|m{--ary--}\n\nBody.\n', 'one character, since the caret sits before the strike');
  ed.press('ArrowRight', 2);
  assert.equal(ed.marked, '## Summ{--ary--}|\n\nBody.\n', 'and over the whole strike coming back');
});

test('typing over a selection reads as one replacement', () => {
  const ed = editor('a completely b\n').select('completely').type('largely');
  assert.equal(ed.source, 'a {~~completely~>largely~~} b\n');
});

test('pasting is one edit, not one per character', () => {
  const ed = editor('start end\n').caretAfter('start').paste(' middle');
  assert.equal(ed.source, 'start{++ middle++} end\n');
});
