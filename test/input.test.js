/**
 * Translating browser events into editing actions.
 *
 * `input.js` cancels every `beforeinput` and turns it into an operation on the
 * markdown source. That means an `inputType` the switch does not name is a
 * keystroke that silently does nothing — which is how ⌘X came to put the
 * selection on the clipboard and leave it in the document, a copy rather than a
 * cut.
 *
 * These dispatch the events themselves, so what they prove is that the mapping
 * is right — not that a real key produces the event in question. That second
 * half needs a real browser, and is why `e.code` matters below.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom.js';
import { attachInput, attachShortcuts } from '../src/input.js';
import { editor } from './harness.js';

const doc = installDom();

/** A document node with `input.js` attached and a record of what it asked for. */
function wired(options = {}) {
  const node = doc.createElement('div');
  doc.body.append(node);
  const seen = { actions: [], undo: 0, redo: 0, carets: [] };
  attachInput(node, {
    read: () => options.selection || { start: 5, end: 5 },
    apply: (result) => { seen.actions.push(result); return 'applied'; },
    getText: () => options.text || 'Alpha beta gamma.\n',
    getView: () => 'rendered',
    canEdit: () => true,
    undo: () => { seen.undo++; },
    redo: () => { seen.redo++; },
    onComposedRender: () => {},
    setCaret: (c) => { seen.carets.push(c); },
    stepInView: options.stepInView,
    onTab: options.onTab,
  });
  const fire = (inputType, extra = {}) => {
    const e = new window.InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true, ...extra });
    node.dispatchEvent(e);
    return e;
  };
  const key = (init) => {
    const e = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    node.dispatchEvent(e);
    return e;
  };
  return { node, seen, fire, key };
}

/**
 * Each `inputType` and the text it should leave behind, starting from
 * "Alpha beta gamma." with "beta" selected.
 */
const SELECTION = { start: 6, end: 10 };
const onSelection = [
  ['deleteContentBackward', 'Alpha {--beta--} gamma.\n'],
  ['deleteByCut', 'Alpha {--beta--} gamma.\n'],
  ['deleteByDrag', 'Alpha {--beta--} gamma.\n'],
  ['deleteContent', 'Alpha {--beta--} gamma.\n'],
];

for (const [inputType, expected] of onSelection) {
  test(`${inputType} deletes the selection`, () => {
    const w = wired({ selection: SELECTION });
    w.fire(inputType);
    assert.equal(w.seen.actions.length, 1, `${inputType} did nothing at all`);
    assert.equal(w.seen.actions[0].text, expected);
  });
}

test('cut with nothing selected takes nothing', () => {
  const w = wired({ selection: { start: 5, end: 5 } });
  w.fire('deleteByCut');
  assert.deepEqual(w.seen.actions, [null], 'there is no selection to cut');
});

test('deleting to the end of the line is handled, in all three spellings', () => {
  for (const inputType of ['deleteSoftLineForward', 'deleteHardLineForward', 'deleteEntireSoftLine']) {
    const w = wired({ selection: { start: 6, end: 6 }, text: 'Alpha beta gamma.\nNext line.\n' });
    w.fire(inputType);
    assert.equal(w.seen.actions[0] && w.seen.actions[0].text, 'Alpha {--beta gamma.--}\nNext line.\n', inputType);
  }
});

test('typing, breaking a paragraph and pasting all arrive', () => {
  const w = wired();
  w.fire('insertText', { data: 'X' });
  w.fire('insertParagraph');
  w.fire('insertFromPaste', { data: 'pasted' });
  assert.equal(w.seen.actions.length, 3);
  assert.ok(w.seen.actions.every((a) => a && a.text), 'each produced a change');
});

test('undo and redo are passed through rather than applied', () => {
  const w = wired();
  w.fire('historyUndo');
  w.fire('historyRedo');
  assert.deepEqual([w.seen.undo, w.seen.redo], [1, 1]);
  assert.equal(w.seen.actions.length, 0);
});

test('every beforeinput is cancelled, except composition', () => {
  const w = wired();
  assert.equal(w.fire('insertText', { data: 'X' }).defaultPrevented, true);
  assert.equal(w.fire('somethingUnheardOf').defaultPrevented, true, 'cancelled even when unhandled');
  assert.equal(w.fire('insertCompositionText').defaultPrevented, false,
    'cancelling this one breaks IME; it is handled at compositionend');
});

/* --- shortcuts ------------------------------------------------------------- */

/** Attach the shortcuts and record which commands fire. */
function shortcuts() {
  const seen = [];
  const note = (name) => (arg) => seen.push(arg === undefined ? name : `${name}:${arg}`);
  attachShortcuts({
    undo: note('undo'), redo: note('redo'), save: note('save'), comment: note('comment'),
    escape: note('escape'), dialogOpen: () => false,
    commands: {
      bold: note('bold'), italic: note('italic'), bullet: note('bullet'),
      numbered: note('numbered'), heading: note('heading'), reasons: note('reasons'),
    },
  });
  const press = (init) => {
    const e = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    window.dispatchEvent(e);
    return e;
  };
  return { seen, press };
}

test('the list shortcuts fire on the physical key, not the character it types', () => {
  // With Shift held the 8 key reports '*' and the 7 key '&' on a US layout. A
  // shortcut matched on e.key passes a test that sends the digit and still
  // never fires for a real person.
  const s = shortcuts();
  s.press({ key: '*', code: 'Digit8', metaKey: true, shiftKey: true });
  s.press({ key: '&', code: 'Digit7', metaKey: true, shiftKey: true });
  assert.deepEqual(s.seen, ['bullet', 'numbered']);
});

test('heading levels fire on the physical key too', () => {
  const s = shortcuts();
  // Alt produces dead keys and symbols on most layouts; the code does not care.
  s.press({ key: '¡', code: 'Digit1', metaKey: true, altKey: true });
  s.press({ key: '™', code: 'Digit2', metaKey: true, altKey: true });
  s.press({ key: 'º', code: 'Digit0', metaKey: true, altKey: true });
  assert.deepEqual(s.seen, ['heading:1', 'heading:2', 'heading:0']);
});

test('undo, redo, save, bold and italic', () => {
  const s = shortcuts();
  s.press({ key: 'z', code: 'KeyZ', metaKey: true });
  s.press({ key: 'z', code: 'KeyZ', metaKey: true, shiftKey: true });
  s.press({ key: 's', code: 'KeyS', metaKey: true });
  s.press({ key: 'b', code: 'KeyB', metaKey: true });
  s.press({ key: 'i', code: 'KeyI', metaKey: true });
  assert.deepEqual(s.seen, ['undo', 'redo', 'save', 'bold', 'italic']);
});

test('a plain letter is typing, not a command', () => {
  const s = shortcuts();
  s.press({ key: 'b', code: 'KeyB' });
  assert.deepEqual(s.seen, []);
});

test('Tab is handed to the list structure instead of moving focus', () => {
  const seen = [];
  const w = wired({ onTab: (out) => seen.push(out) });
  assert.equal(w.key({ key: 'Tab' }).defaultPrevented, true);
  assert.equal(w.key({ key: 'Tab', shiftKey: true }).defaultPrevented, true);
  assert.deepEqual(seen, [false, true]);
});

/* --- arrows ---------------------------------------------------------------- */

test('an arrow asks the rendered view first, since it knows what is on screen', () => {
  const w = wired({ selection: { start: 5, end: 5 }, stepInView: () => 9 });
  w.key({ key: 'ArrowRight' });
  assert.deepEqual(w.seen.carets, [{ start: 9, end: 9 }]);
});

test('vertical arrows ask the rendered view for a layout-aware destination', () => {
  const calls = [];
  const w = wired({
    selection: { start: 5, end: 5 },
    stepInView: (offset, dir, axis) => { calls.push([offset, dir, axis]); return 9; },
  });
  const up = w.key({ key: 'ArrowUp' });
  const down = w.key({ key: 'ArrowDown' });
  assert.equal(up.defaultPrevented, true);
  assert.equal(down.defaultPrevented, true);
  assert.deepEqual(calls, [[5, -1, 'vertical'], [5, 1, 'vertical']]);
  assert.deepEqual(w.seen.carets, [{ start: 9, end: 9 }, { start: 9, end: 9 }]);
});

test('an arrow falls back to plain stepping when the view has no opinion', () => {
  const w = wired({ selection: { start: 5, end: 5 }, stepInView: () => null });
  w.key({ key: 'ArrowLeft' });
  assert.deepEqual(w.seen.carets, [{ start: 4, end: 4 }]);
});

test('a modified arrow is left to the browser', () => {
  for (const mod of ['shiftKey', 'altKey', 'metaKey']) {
    const w = wired({ selection: { start: 5, end: 5 }, stepInView: () => 9 });
    const e = w.key({ key: 'ArrowRight', [mod]: true });
    assert.deepEqual(w.seen.carets, [], `${mod}+Arrow should be the browser's`);
    assert.equal(e.defaultPrevented, false);
  }
});

/* --- composition ----------------------------------------------------------- */

test('a composed string arrives as an ordinary insertion', () => {
  const w = wired({ selection: { start: 6, end: 6 } });
  w.node.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true }));
  w.node.dispatchEvent(new window.CompositionEvent('compositionend', { data: 'こんにちは', bubbles: true }));
  assert.equal(w.seen.actions.length, 1);
  assert.equal(w.seen.actions[0].text, 'Alpha {++こんにちは++}beta gamma.\n');
});

test('composing over a code block is refused like everything else', () => {
  // Composition can start over a selection, and it used to go straight to the
  // edit engine, skipping the guard that keeps a fence from being swallowed.
  const text = 'Before\n\n```\ncode\n```\n\nAfter\n';
  const w = wired({ text, selection: { start: 0, end: text.indexOf('After') + 5 } });
  w.node.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true }));
  w.node.dispatchEvent(new window.CompositionEvent('compositionend', { data: 'x', bubbles: true }));
  assert.deepEqual(w.seen.actions, [{ blocked: { kind: 'unsupported', reason: 'code' } }]);
});

test('composition itself is left alone until it ends', () => {
  const w = wired();
  assert.equal(w.fire('insertCompositionText').defaultPrevented, false);
  assert.equal(w.seen.actions.length, 0, 'nothing is applied mid-composition');
});

test('dragging text within the document does not duplicate it', () => {
  // A drag is two events: the source is deleted, then the text is inserted at
  // the drop point. Nothing reads the drop point out of `getTargetRanges`, so
  // it lands back where it started and the two cancel. That leaves the drag
  // doing nothing, which is a limitation — but it used to leave a copy behind,
  // which is a bug.
  const ed = editor('Alpha beta gamma.\n').select('beta');
  const dragged = 'beta';
  ed.press('Cut');
  assert.equal(ed.source, 'Alpha {--beta--} gamma.\n');
  ed.paste(dragged);
  assert.equal(ed.source, 'Alpha beta gamma.\n', 'and the pair cancels rather than doubling the word');
});
