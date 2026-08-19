/**
 * A headless editor, for testing behaviour without a browser.
 *
 * It drives the real code — `editor.js` for what each keystroke means,
 * `normalize` for settling the result — so anything this harness proves is true
 * of the app. The one thing it cannot see is the screen: whether an offset has
 * a position in the rendered view is a DOM question, and lives in
 * `dom/offsets.js`.
 *
 *   const ed = editor('## Heading\n\nSome text.\n');
 *   ed.caretBefore('Some').press('Enter').type('X');
 *   ed.source;      // the markdown, annotations and all
 *   ed.accepted;    // what the document becomes if every edit is taken
 *   ed.rejected;    // what it was before any of them
 */

import { applyAction, moveCaret } from '../src/editor.js';
import { normalize } from '../src/edits.js';
import { transform } from '../src/criticmarkup.js';

const KEYS = {
  Enter: { type: 'insertParagraph' },
  Backspace: { type: 'deleteBackward' },
  Delete: { type: 'deleteForward' },
  'Alt+Backspace': { type: 'deleteWordBackward' },
  'Alt+Delete': { type: 'deleteWordForward' },
  'Cmd+Backspace': { type: 'deleteLineBackward' },
};

export function editor(initial, options = {}) {
  let text = initial;
  let caret = { start: 0, end: 0 };
  const view = options.view || 'rendered';
  const log = [];

  const api = {
    get source() { return text; },
    get accepted() { return transform(text, 'accepted'); },
    get rejected() { return transform(text, 'rejected'); },
    get caret() { return { ...caret }; },
    get history() { return log.slice(); },

    /** Where the caret is, marked with a pipe — handy in assertion messages. */
    get marked() { return `${text.slice(0, caret.start)}|${text.slice(caret.start)}`; },

    /* --- placing the caret ------------------------------------------------ */

    caretAt(offset) { caret = { start: offset, end: offset }; return api; },
    caretBefore(needle) {
      const i = text.indexOf(needle);
      if (i < 0) throw new Error(`caretBefore: ${JSON.stringify(needle)} not found in ${JSON.stringify(text)}`);
      return api.caretAt(i);
    },
    caretAfter(needle) {
      const i = text.indexOf(needle);
      if (i < 0) throw new Error(`caretAfter: ${JSON.stringify(needle)} not found in ${JSON.stringify(text)}`);
      return api.caretAt(i + needle.length);
    },
    caretAtEnd() { return api.caretAt(text.length); },
    select(needle) {
      const i = text.indexOf(needle);
      if (i < 0) throw new Error(`select: ${JSON.stringify(needle)} not found in ${JSON.stringify(text)}`);
      caret = { start: i, end: i + needle.length };
      return api;
    },
    selectRange(start, end) { caret = { start, end }; return api; },

    /* --- acting ------------------------------------------------------------ */

    /** Type a string one character at a time, as a keyboard would. */
    type(str) {
      for (const ch of str) api.act({ type: 'insertText', data: ch });
      return api;
    },
    /** Paste, which arrives all at once rather than key by key. */
    paste(str) { return api.act({ type: 'paste', data: str }); },

    /** Press a named key, optionally more than once. */
    press(key, times = 1) {
      for (let i = 0; i < times; i++) {
        if (key === 'ArrowLeft') { caret = moveCaret(text, caret, -1); log.push('ArrowLeft'); continue; }
        if (key === 'ArrowRight') { caret = moveCaret(text, caret, 1); log.push('ArrowRight'); continue; }
        const action = KEYS[key];
        if (!action) throw new Error(`press: unknown key ${key}`);
        api.act(action);
      }
      return api;
    },

    /** Apply a raw action and settle the result, exactly as the app does. */
    act(action) {
      const result = applyAction({ text, caret, view }, action);
      log.push(action.type + (action.data ? ` ${JSON.stringify(action.data)}` : ''));
      if (!result) return api;
      if (result.blocked) { log.push('  (refused)'); return api; }
      if (result.text === undefined) { caret = result.caret; return api; }
      const settled = normalize(result.text, result.caret);
      text = settled.text;
      caret = settled.caret;
      return api;
    },
  };

  return api;
}

/**
 * The invariant every editing sequence must hold: rejecting every annotation
 * gives back exactly the document you started with. If this ever fails, the
 * tool has destroyed someone's text.
 */
export function assertReversible(assert, ed, original) {
  assert.equal(ed.rejected, original,
    `rejecting every change should restore the original\n  history: ${ed.history.join(' → ')}`);
}
