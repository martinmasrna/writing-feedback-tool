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
  assertReversible(assert, ed);
  assert.equal(ed.accepted, '## Overview\n\nThe loader is a stopgap (for now) that largely rewrites things.\n');
});

test('Enter opens one blank line per press', () => {
  const ed = editor('## Heading\n\nBody text.\n').caretBefore('Body');
  ed.press('Enter', 3);
  assert.equal(ed.accepted, '## Heading\n\n\n\n\nBody text.\n');
  assertReversible(assert, ed);
});

test('backspace at the top of a block joins it to the one above', () => {
  const ed = editor('## Heading\n\nBody text.\n').caretBefore('Body').press('Backspace');
  assert.equal(ed.accepted, '## HeadingBody text.\n');
  assertReversible(assert, ed);
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

/* --- found by the testing agents ------------------------------------------ */

test('backspace at the head of a heading removes the whole marker', () => {
  const ed = editor('# Heading\n').caretBefore('Heading').press('Backspace');
  assert.equal(ed.accepted, 'Heading\n', 'not "#Heading", which is not a heading at all');
  assertReversible(assert, ed);
});

test('backspace at the head of a list item removes the bullet', () => {
  const ed = editor('- Item one\n').caretBefore('Item').press('Backspace');
  assert.equal(ed.accepted, 'Item one\n');
  assertReversible(assert, ed);
});

test('Enter at the end of a list starts the next item, not a gap', () => {
  const ed = editor('- Item\n').caretAtEnd().press('Enter');
  assert.equal(ed.accepted, '- Item\n- ');
});

test('Enter inside a list item still splits it into two', () => {
  const ed = editor('- Item one\n').caretAfter('Item').press('Enter');
  assert.equal(ed.accepted, '- Item\n-  one\n');
});

/* --- found by the reference model ----------------------------------------- */

test('backspace removes a bullet the same Enter just wrote', () => {
  // Enter in a list writes the next `- ` inside the insertion, so the marker
  // rule has to reach into a change still in flight. It used to strike out one
  // character and leave a stray `-` sitting in the document as body text.
  const ed = editor('- one\n- two\n').select('two').press('Enter').press('Backspace');
  assert.equal(ed.accepted, '- one\n- \n\n', 'the whole bullet goes, not the space after it');
  assertReversible(assert, ed);
});

test('backspace removes a heading marker whose text is already struck', () => {
  // With the content struck, the only offset the caret can occupy is before the
  // opening delimiter — several characters short of the mapped contentStart.
  // Comparing source offsets there missed the marker and ate the space,
  // leaving `#`, which is not a heading.
  const ed = editor('# Title\n\nBody.\n').select('Title').press('Backspace').press('Backspace');
  assert.equal(ed.accepted, '\n\nBody.\n', 'not "#", a marker with nothing to mark');
  assertReversible(assert, ed);
});

test('rejected is the text underneath, not the string you passed in', () => {
  const ed = editor('Text with {~~old~>new~~} replacement.\n');
  assert.equal(ed.original, 'Text with old replacement.\n');
  assert.equal(ed.rejected, ed.original);
  assert.equal(ed.accepted, 'Text with new replacement.\n');
});

test('the harness refuses a caret inside markup', () => {
  const ed = editor('a {--gone--} b');
  assert.throws(() => ed.caretAt(5), /inside markup/);
});

test('a selection that swallows a code block is refused', () => {
  const original = 'Before the code.\n\n```js\nconst x = 1;\n```\n\nAfter the code.\n';
  const ed = editor(original);
  ed.selectRange(7, original.indexOf('After') + 5);
  ed.type('Z');
  assert.equal(ed.source, original, 'the document is untouched');
});

test('the same selection is refused for deletion too', () => {
  const original = 'Before.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nAfter.\n';
  const ed = editor(original);
  ed.selectRange(0, original.indexOf('After') + 5);
  ed.press('Backspace');
  assert.equal(ed.source, original, 'a table is not swallowed either');
});

test('editing either side of a code block still works', () => {
  const original = 'Before the code.\n\n```js\nconst x = 1;\n```\n\nAfter the code.\n';
  const ed = editor(original).select('Before').type('Above');
  assert.equal(ed.accepted, 'Above the code.\n\n```js\nconst x = 1;\n```\n\nAfter the code.\n');
  assertReversible(assert, ed);
});
