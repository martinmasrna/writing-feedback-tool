import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  insert, deleteBackward, deleteForward, deleteRange,
  deleteWordBackward, deleteWordForward, deleteLineBackward,
  annotate, setReason, removeAnnotation,
} from '../src/edits.js';
import { transform, parse } from '../src/criticmarkup.js';

/** Apply a result to a {text, caret} pair, asserting it was not refused. */
function step(doc, result) {
  assert.ok(result, 'expected an operation, got null');
  assert.ok(!result.blocked, 'operation was unexpectedly blocked');
  return { text: result.text ?? doc.text, caret: result.caret ?? doc.caret };
}
/** Type a string one character at a time, as a real keyboard would. */
function type(doc, str) {
  for (const ch of str) doc = step(doc, insert(doc.text, doc.caret, ch));
  return doc;
}
/** Press backspace n times. */
function backspace(doc, n = 1) {
  for (let i = 0; i < n; i++) doc = step(doc, deleteBackward(doc.text, doc.caret.start));
  return doc;
}
const start = (text, p) => ({ text, caret: { start: p, end: p } });

/* --- Insertion ------------------------------------------------------------ */

test('typing produces one insertion, not one per character', () => {
  const doc = type(start('Hello world.', 5), ' there');
  assert.equal(doc.text, 'Hello{++ there++} world.');
  assert.equal(parse(doc.text).length, 1);
});

test('the caret stays inside the insertion while typing', () => {
  const doc = type(start('ab', 1), 'XY');
  assert.equal(doc.text, 'a{++XY++}b');
  assert.equal(doc.caret.start, doc.text.indexOf('XY') + 2);
});

test('typing accepts cleanly and leaves the original intact when rejected', () => {
  const doc = type(start('Hello world.', 5), ' there');
  assert.equal(transform(doc.text, 'accepted'), 'Hello there world.');
  assert.equal(transform(doc.text, 'rejected'), 'Hello world.');
});

test('newlines are inserted like any other character', () => {
  const doc = type(start('para', 4), '\n\nnext');
  assert.equal(doc.text, 'para{++\n\nnext++}');
  assert.equal(transform(doc.text, 'accepted'), 'para\n\nnext');
});

test('typing over a selection makes a substitution', () => {
  const doc = step(start('It completely works.', 0), insert('It completely works.', { start: 3, end: 13 }, 'largely'));
  assert.equal(doc.text, 'It {~~completely~>largely~~} works.');
  assert.equal(transform(doc.text, 'accepted'), 'It largely works.');
});

test('typing continues inside a substitution replacement', () => {
  let doc = step(start('It completely works.', 0), insert('It completely works.', { start: 3, end: 13 }, 'la'));
  doc = type(doc, 'rgely');
  assert.equal(doc.text, 'It {~~completely~>largely~~} works.');
  assert.equal(parse(doc.text).length, 1);
});

test('typed delimiters are stripped rather than corrupting the file', () => {
  const r = insert('ab', { start: 1, end: 1 }, 'x{++y++}z');
  assert.equal(r.text, 'a{++xyz++}b');
  assert.equal(r.stripped, true);
  assert.equal(parse(r.text).length, 1);
});

test('typing into finished markup snaps out to its edge instead of corrupting it', () => {
  const text = 'a {--gone--} b';
  const inside = text.indexOf('gone') + 1;
  const r = insert(text, { start: inside, end: inside }, 'X');
  assert.ok(!r.blocked);
  assert.equal(parse(r.text).filter((a) => a.type === 'del').length, 1);
  assert.equal(transform(r.text, 'rejected'), 'a gone b');
});

/* --- Deletion ------------------------------------------------------------- */

test('backspace over original text strikes it out', () => {
  const doc = backspace(start('stopgap.', 8), 1);
  assert.equal(doc.text, 'stopgap{--.--}');
  assert.equal(doc.caret.start, 7);
});

test('holding backspace grows one deletion leftwards', () => {
  const doc = backspace(start('a stopgap.', 10), 4);
  assert.equal(doc.text, 'a stop{--gap.--}');
  assert.equal(parse(doc.text).length, 1, 'must merge into a single annotation');
  assert.equal(doc.caret.start, 'a stop'.length);
});

test('backspace erases your own typing without tracking it', () => {
  let doc = type(start('loader', 6), ' v2');
  doc = backspace(doc, 2);
  assert.equal(doc.text, 'loader{++ ++}');
  assert.equal(transform(doc.text, 'accepted'), 'loader ');
});

test('emptying an insertion removes it, then backspace continues into the original', () => {
  let doc = type(start('stopgap', 7), 'X');
  doc = backspace(doc, 1);
  assert.equal(doc.text, 'stopgap', 'the emptied insertion disappears');
  doc = backspace(doc, 1);
  assert.equal(doc.text, 'stopga{--p--}');
});

test('emptying a substitution replacement turns it back into a deletion', () => {
  let doc = step(start('It completely works.', 0), insert('It completely works.', { start: 3, end: 13 }, 'x'));
  doc = backspace(doc, 1);
  assert.equal(doc.text, 'It {--completely--} works.');
});

test('a reason survives a substitution collapsing to a deletion', () => {
  const text = 'It {~~completely~>x~~}{>>too strong<<} works.';
  const p = text.indexOf('~>') + 3;
  const r = deleteBackward(text, p);
  assert.equal(r.text, 'It {--completely--}{>>too strong<<} works.');
});

test('backspace over selected text strikes exactly that text', () => {
  const text = 'It completely works.';
  const doc = step(start(text, 0), deleteRange(text, { start: 3, end: 13 }, 'back'));
  assert.equal(doc.text, 'It {--completely--} works.');
  assert.equal(transform(doc.text, 'accepted'), 'It  works.');
  assert.equal(transform(doc.text, 'rejected'), text);
});

test('backspace beside finished markup steps over it instead of editing it', () => {
  const text = 'a {--gone--} b';
  const after = text.indexOf('--}') + 3;
  const r = deleteBackward(text, after);
  assert.equal(r.text, undefined, 'no text change');
  assert.equal(r.caret.start, text.indexOf('{--'));
});

test('forward delete strikes out and merges rightwards', () => {
  let text = 'a stopgap.';
  let r = deleteForward(text, 2);
  assert.equal(r.text, 'a {--s--}topgap.');
  r = deleteForward(r.text, r.caret.start);
  assert.equal(r.text, 'a {--st--}opgap.');
  assert.equal(parse(r.text).length, 1);
});

test('forward delete steps over finished markup', () => {
  const text = 'a {--gone--} b';
  const r = deleteForward(text, text.indexOf('{--'));
  assert.equal(r.text, undefined);
  assert.equal(r.caret.start, text.indexOf('--}') + 3);
});

test('backspace at the very start of the document is a no-op', () => {
  assert.equal(deleteBackward('abc', 0), null);
  assert.equal(deleteForward('abc', 3), null);
});

/* --- Word and line granularity ------------------------------------------- */

test('option-backspace strikes a whole word', () => {
  const text = 'delete this word';
  const r = deleteWordBackward(text, text.length);
  assert.equal(r.text, 'delete this {--word--}');
});

test('repeated option-backspace merges into one deletion', () => {
  const text = 'delete this word';
  let r = deleteWordBackward(text, text.length);
  r = deleteWordBackward(r.text, r.caret.start);
  assert.equal(r.text, 'delete {--this word--}');
  assert.equal(parse(r.text).length, 1, 'must merge rather than chain');
});

test('word deletion stops at an annotation boundary', () => {
  const text = 'keep {--gone--} tail';
  const r = deleteWordBackward(text, text.length);
  assert.equal(r.text, 'keep {--gone--} {--tail--}');
  assert.equal(transform(r.text, 'rejected'), 'keep gone tail');
});

test('option-forward-delete strikes the next word', () => {
  const text = 'alpha beta';
  const r = deleteWordForward(text, 0);
  assert.equal(r.text, '{--alpha--} beta');
});

test('cmd-backspace strikes to the start of the line', () => {
  const text = 'line one\nline two';
  const r = deleteLineBackward(text, text.length);
  assert.equal(r.text, 'line one\n{--line two--}');
});

/* --- Guard rails ---------------------------------------------------------- */

test('a selection crossing an annotation boundary is refused', () => {
  const text = 'aa {--bb--} cc';
  const r = deleteRange(text, { start: 0, end: text.indexOf('bb') + 1 }, 'back');
  assert.ok(r.blocked);
  assert.equal(r.blocked.type, 'del');
});

test('typing over a selection that swallows an annotation is refused', () => {
  const text = 'aa {--bb--} cc';
  const r = insert(text, { start: 0, end: text.length }, 'x');
  assert.ok(r.blocked);
});

test('a selection ending exactly where an annotation begins is allowed, and merges', () => {
  const text = 'aa {--bb--} cc';
  const r = deleteRange(text, { start: 0, end: text.indexOf('{--') }, 'back');
  assert.ok(!r.blocked);
  assert.equal(r.text, '{--aa bb--} cc');
  assert.equal(transform(r.text, 'rejected'), 'aa bb cc');
});

/* --- Reasons and removal -------------------------------------------------- */

test('attaching a reason writes the comment after the edit', () => {
  const text = 'a {--gone--} b';
  const r = setReason(text, text.indexOf('{--'), 'redundant');
  assert.equal(r.text, 'a {--gone--}{>>redundant<<} b');
});

test('rewriting a reason replaces the existing comment', () => {
  const text = 'a {--gone--}{>>old<<} b';
  const r = setReason(text, text.indexOf('{--'), 'new');
  assert.equal(r.text, 'a {--gone--}{>>new<<} b');
});

test('clearing a reason removes the comment entirely', () => {
  const text = 'a {--gone--}{>>old<<} b';
  const r = setReason(text, text.indexOf('{--'), '');
  assert.equal(r.text, 'a {--gone--} b');
});

test('a caret after the reason shifts to stay put', () => {
  const text = 'a {--gone--} bcd';
  const anchor = text.length - 1;
  const r = setReason(text, text.indexOf('{--'), 'why', { start: anchor, end: anchor });
  assert.equal(r.text.charAt(r.caret.start), text.charAt(anchor));
});

test('removing an annotation restores the original text exactly', () => {
  const original = 'It completely rewrites the batch pipeline.';
  let text = insert(original, { start: 3, end: 13 }, 'largely').text;
  const sub = parse(text)[0];
  const r = removeAnnotation(text, sub.start);
  assert.equal(r.text, original);
});

test('removing an insertion leaves nothing behind', () => {
  const text = 'loader{++ v2++}{>>why<<}';
  const r = removeAnnotation(text, 6);
  assert.equal(r.text, 'loader');
});

/* --- End-to-end sequences ------------------------------------------------- */

test('a full editing session yields valid markup and a clean rejection', () => {
  const original = 'The loader is a stopgap. It completely rewrites the pipeline.\n';
  let doc = start(original, original.indexOf('.') + 1);
  doc = type(doc, ' Worth revisiting.');        // type an insertion
  doc = backspace(doc, 18);                     // then erase every character of it
  doc = backspace(doc, 4);                      // strike "gap." out of the original
  const cut = parse(doc.text).find((a) => a.type === 'del');
  doc = step(doc, setReason(doc.text, cut.start, 'Too informal.'));
  const at = doc.text.indexOf('completely');
  doc = step(doc, insert(doc.text, { start: at, end: at + 10 }, 'largely'));

  assert.equal(transform(doc.text, 'rejected'), original, 'rejecting everything restores the source');
  assert.equal(transform(doc.text, 'accepted'), 'The loader is a stop It largely rewrites the pipeline.\n');
  const kinds = parse(doc.text).map((a) => a.type).sort();
  assert.deepEqual(kinds, ['del', 'sub']);
});

test('annotate() covers the toolbar dialogs', () => {
  const text = 'It completely works.';
  const sel = { start: 3, end: 13 };
  assert.equal(annotate(text, sel, 'sub', 'largely', 'why').text, 'It {~~completely~>largely~~}{>>why<<} works.');
  assert.equal(annotate(text, sel, 'del', '', 'why').text, 'It {--completely--}{>>why<<} works.');
  assert.equal(annotate(text, sel, 'hl', '', 'note').text, 'It {==completely==}{>>note<<} works.');
});
