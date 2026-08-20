/**
 * The document store: history, the caret, and dirty tracking.
 *
 * This is the module that holds the user's work, and undo is the one place
 * where a bug quietly destroys it rather than merely showing the wrong thing.
 * It had no tests at all.
 *
 * The store is driven the way `app.js` drives it — results from the real edit
 * engine, fed to `store.apply()` — so what these prove is true of the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state.js';
import { applyAction } from '../src/editor.js';
import { parse, regionAt } from '../src/criticmarkup.js';

/** A store with a document in it, and a way to type into it. */
function loaded(text) {
  const store = createStore();
  store.load(text, 'doc.md', null);
  const act = (action, at) => {
    if (at !== undefined) store.setCaret({ start: at, end: at });
    return store.apply(applyAction({ text: store.state.text, caret: store.state.caret, view: 'rendered' }, action));
  };
  return {
    store,
    get text() { return store.state.text; },
    get depth() { return store.state.undo.length; },
    type(str) { for (const ch of str) act({ type: 'insertText', data: ch }); return this; },
    press(type) { act({ type }); return this; },
    /** Put the caret before `needle` in the document as it stands now. */
    at(needle) {
      const i = store.state.text.indexOf(needle);
      assert.ok(i >= 0, `at: ${JSON.stringify(needle)} is not in ${JSON.stringify(store.state.text)}`);
      store.setCaret({ start: i, end: i });
      return this;
    },
  };
}

/* --- what undo must never get wrong --------------------------------------- */

test('undo returns the document exactly, however much was typed', () => {
  const original = '# Title\n\nA paragraph of prose.\n';
  const s = loaded(original);
  s.at('paragraph').type('long ');
  s.at('prose').press('deleteWordForward');
  assert.notEqual(s.text, original);
  while (s.store.undo()) { /* all the way back */ }
  assert.equal(s.text, original);
});

test('redo returns to where undo left from', () => {
  const s = loaded('# Title\n\nA paragraph of prose.\n');
  s.at('paragraph').type('long ');
  const edited = s.text;
  while (s.store.undo()) { /* back */ }
  while (s.store.redo()) { /* and forward */ }
  assert.equal(s.text, edited);
});

test('editing on top of an undo throws the redo away', () => {
  const s = loaded('# Title\n\nA paragraph.\n');
  s.at('paragraph').type('short ');
  s.store.undo();
  assert.ok(s.store.state.redo.length > 0, 'there is something to redo');
  s.at('paragraph').type('other ');
  assert.equal(s.store.state.redo.length, 0, 'that future is gone, as it is in every editor');
});

test('the caret is always somewhere a user could have put it', () => {
  const s = loaded('# Title\n\nA paragraph of prose.\n');
  const legal = (where) => {
    const c = s.store.state.caret;
    if (!c) return;
    assert.ok(c.start >= 0 && c.start <= s.text.length, `${where}: caret out of range`);
    assert.notEqual(regionAt(parse(s.text), c.start).kind, 'atomic', `${where}: caret inside markup`);
  };
  s.at('prose').press('deleteWordBackward'); legal('after a word delete');
  s.type('clear '); legal('after typing');
  s.store.undo(); legal('after undo');
  s.store.redo(); legal('after redo');
});

test('undo survives a document that already had annotations', () => {
  const original = 'Text with {~~old~>new~~} replacement.\n';
  const s = loaded(original);
  s.at('replacement').type('the ');
  while (s.store.undo()) { /* back */ }
  assert.equal(s.text, original, 'including the annotations it arrived with');
});

/* --- undo granularity ------------------------------------------------------ */

/** Run `fn` with the clock frozen, so coalescing is decided by us, not by speed. */
function atTime(ms, fn) {
  const real = Date.now;
  Date.now = () => ms;
  try { return fn(); } finally { Date.now = real; }
}

test('a burst of typing is one undo step, not one per key', () => {
  const s = loaded('# T\n\nBody.\n');
  s.at('Body');
  atTime(1000, () => s.type('several words'));
  assert.equal(s.depth, 1, 'thirteen keystrokes, one step');
  s.store.undo();
  assert.equal(s.text, '# T\n\nBody.\n');
});

test('a pause between keystrokes starts a new undo step', () => {
  const s = loaded('# T\n\nBody.\n');
  s.at('Body');
  atTime(1000, () => s.type('one'));
  atTime(5000, () => s.type('two'));
  assert.equal(s.depth, 2, 'the pause makes them separate edits');
});

test('changing what you are doing starts a new undo step', () => {
  const s = loaded('# T\n\nBody text.\n');
  s.at('text');
  atTime(1000, () => { s.type('some'); s.press('deleteBackward'); });
  assert.equal(s.depth, 2, 'typing then deleting is two steps, however fast');
});

/* --- dirty tracking -------------------------------------------------------- */

test('a document is dirty once edited and clean again once undone', () => {
  const s = loaded('# T\n\nBody.\n');
  assert.equal(s.store.dirty(), false);
  s.at('Body').type('X');
  assert.equal(s.store.dirty(), true);
  while (s.store.undo()) { /* back */ }
  assert.equal(s.store.dirty(), false, 'undone all the way is the same as never touched');
});

test('saving makes the current text the clean one', () => {
  const s = loaded('# T\n\nBody.\n');
  s.at('Body').type('X');
  s.store.markSaved('doc.md', null);
  assert.equal(s.store.dirty(), false);
  s.store.undo();
  assert.equal(s.store.dirty(), true, 'undoing past a save is a change again');
});
