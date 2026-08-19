/**
 * The editor, held against a plain text editor.
 *
 * Every other test in this suite proves something about the *document*: that
 * the markup stays well formed, that rejecting every change gives the original
 * back. None of that says the thing behaves like a text editor, which is the
 * actual bar and until now lived only in a person's judgement.
 *
 * `mirror()` feeds the same keystrokes to the real editor and to a plain one
 * written from scratch in `harness.js`, and asserts after each that the
 * accepted document and the caret agree. The fuzz test runs the same machinery
 * over ten thousand random keystrokes; these are the cases worth naming.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mirror, referenceEditor, acceptedOffset, blockMarker } from './harness.js';

/** Run a session and fail with the disagreement, if there was one. */
function agree(m) {
  assert.equal(m.divergence && m.divergence.message, null);
  return m;
}

/* --- ordinary editing ------------------------------------------------------ */

test('typing into a paragraph does what typing does', () => {
  agree(mirror('# Title\n\nA paragraph of words.\n').caretAfter('paragraph').type(' full'));
});

test('deleting a word does what deleting does', () => {
  agree(mirror('# Title\n\nA paragraph of words.\n').select('paragraph').press('Backspace'));
});

test('replacing a selection does what replacing does', () => {
  agree(mirror('a completely b\n').select('completely').type('largely'));
});

test('deleting a word and typing it back leaves the text where it started', () => {
  const m = agree(mirror('## Summary\n\nBody.\n').select('ary').press('Backspace').type('ary'));
  assert.equal(m.ed.source, '## Summary\n\nBody.\n', 'and no annotation behind it');
});

test('a burst of typing then backspacing over it nets out', () => {
  agree(mirror('Hello world.\n').caretAfter('Hello').type(' there').press('Backspace', 6));
});

test('holding backspace walks back through a sentence', () => {
  agree(mirror('# T\n\nOne two three four.\n').caretAtEnd().press('Backspace', 12));
});

test('forward delete eats forwards', () => {
  agree(mirror('# T\n\nOne two three.\n').caretBefore('two').press('Delete', 4));
});

test('word delete takes a word', () => {
  agree(mirror('# T\n\nOne two three four.\n').caretAfter('three').press('Alt+Backspace'));
});

test('editing on both sides of an existing change stays in step', () => {
  agree(mirror('Text with {~~old~>new~~} replacement.\n')
    .caretBefore('Text').type('More ')
    .select('replacement.').press('Backspace'));
});

test('a long mixed session stays in step throughout', () => {
  agree(mirror('## Heading\n\n- one\n- two\n\nTrailing paragraph.\n')
    .select('Heading').type('Summary')
    .select('two').press('Backspace')
    .caretAfter('one').type(' and a half')
    .select('Trailing').type('Closing')
    .caretAtEnd().press('Backspace', 3));
});

/* --- what the model declines to judge, and why ----------------------------- */

test('Enter is left to the structural tests, and says so', () => {
  const m = agree(mirror('# T\n\nBody text.\n').caretAfter('Body').press('Enter'));
  assert.deepEqual(m.skipped, ['Enter: no plain-text meaning'],
    'a markdown paragraph break is two newlines; a plain editor has no such rule');
});

test('arrow keys are ours to drive, not the reference model\'s', () => {
  const m = agree(mirror('# T\n\nBody text.\n').select('text').press('Backspace').press('ArrowLeft'));
  assert.ok(m.skipped.some((s) => s.startsWith('ArrowLeft')),
    'one press steps over a whole deletion, which is a move of zero accepted characters');
});

test('a keystroke the editor refuses is not held against it', () => {
  const m = agree(mirror('Before\n\n```\ncode\n```\n\nAfter\n').select('Before').press('Backspace'));
  assert.ok(m.skipped.length === 0 || m.skipped.every((s) => s.includes('refused')));
});

/* --- the reference editor itself ------------------------------------------- */

test('the reference editor is a plain text editor', () => {
  const ref = referenceEditor('hello world');
  ref.setCaret({ start: 5, end: 5 }).insert(' there');
  assert.equal(ref.text, 'hello there world');
  ref.wordBackward();
  assert.equal(ref.text, 'hello  world', 'the word goes, the space it sat after stays');
  ref.backspace();
  assert.equal(ref.text, 'hello world');
});

test('the reference editor knows a block marker when it sees one', () => {
  assert.deepEqual(blockMarker('## Heading', 3), { start: 0, end: 3, text: '## ' });
  assert.deepEqual(blockMarker('- item', 2), { start: 0, end: 2, text: '- ' });
  assert.deepEqual(blockMarker('  1. item', 5), { start: 2, end: 5, text: '  1. ' });
  assert.equal(blockMarker('plain text', 3), null);
  assert.equal(blockMarker('#nospace', 3), null, 'not a heading without the space');
});

test('a source offset maps to where it lands in the accepted text', () => {
  const src = 'a{--deleted--}b{++added++}c';
  assert.equal(acceptedOffset(src, 0), 0);
  assert.equal(acceptedOffset(src, 1), 1, 'before the deletion');
  assert.equal(acceptedOffset(src, 14), 1, 'after it — the struck text is not there');
  assert.equal(acceptedOffset(src, src.length), 'ab'.length + 'added'.length + 1);
});
