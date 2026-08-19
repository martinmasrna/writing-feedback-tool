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
 *   ed.original;    // the document as it stood before this session
 *
 * Two things to be clear about, because misreading either produces convincing
 * nonsense:
 *
 * **`rejected` is not `source`.** If you start from a document that already
 * contains annotations, `rejected` gives the text *underneath* them, not the
 * string you passed in. Compare against `ed.original`, which is exactly that.
 *
 * **Offsets are source offsets.** `ed.caret` indexes `ed.source`, delimiters
 * included, so typing "X" into "hel|lo" leaves the caret at 7 in
 * `hel{++X++}lo` — immediately after the X, which is where typing continues.
 * It is not an offset into the rendered text. `ed.marked` shows it in place.
 */

import { applyAction, moveCaret } from '../src/editor.js';
import { normalize } from '../src/edits.js';
import { transform, parse, regionAt } from '../src/criticmarkup.js';

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
  const original = transform(initial, 'rejected');
  let caret = { start: 0, end: 0 };
  const view = options.view || 'rendered';
  const log = [];

  const api = {
    get source() { return text; },
    get accepted() { return transform(text, 'accepted'); },
    get rejected() { return transform(text, 'rejected'); },
    /** The document before this session — what `rejected` must always equal. */
    get original() { return original; },
    get caret() { return { ...caret }; },
    get history() { return log.slice(); },

    /** Where the caret is, marked with a pipe — handy in assertion messages. */
    get marked() { return `${text.slice(0, caret.start)}|${text.slice(caret.start)}`; },

    /* --- placing the caret ------------------------------------------------ */

    /**
     * Place the caret. Offsets are into `source`. Positions inside markup are
     * refused: the editor never puts the caret there, so a test that starts
     * from one is testing a state no user can reach.
     */
    caretAt(offset) {
      if (offset < 0 || offset > text.length) throw new Error(`caretAt: ${offset} is outside the document (0..${text.length})`);
      if (regionAt(parse(text), offset).kind === 'atomic') {
        throw new Error(`caretAt: ${offset} is inside markup — ${JSON.stringify(`${text.slice(0, offset)}|${text.slice(offset)}`)}`);
      }
      caret = { start: offset, end: offset };
      return api;
    },
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
    /**
     * Select a run of text the way a user would — by dragging over it.
     *
     * Occurrences buried inside markup are skipped: `indexOf` happily finds
     * "Para" inside `{--Para--}`, but that text is contenteditable="false" on
     * screen, so no selection can start there and a test built on one proves
     * nothing about the real editor.
     */
    select(needle) {
      const anns = parse(text);
      for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
        const end = i + needle.length;
        const buried = anns.some((a) => i < a.end && end > a.start);
        if (!buried) { caret = { start: i, end }; return api; }
      }
      throw new Error(`select: no selectable ${JSON.stringify(needle)} in ${JSON.stringify(text)}`);
    },
    selectRange(start, end) {
      if (start < 0 || end > text.length || start > end) throw new Error(`selectRange: ${start}..${end} is not a valid range of 0..${text.length}`);
      caret = { start, end };
      return api;
    },

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
export function assertReversible(assert, ed) {
  assert.equal(ed.rejected, ed.original,
    `rejecting every change should restore the original\n  history: ${ed.history.join(' → ')}`);
}
