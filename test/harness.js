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

import { applyAction, moveCaret, paragraphBreak } from '../src/editor.js';
import { normalize } from '../src/edits.js';
import { transform, parse, tokenize, regionAt, plainRun } from '../src/criticmarkup.js';
import { toVisible, toVisibleOffset } from '../src/visible.js';

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
  let last = { kind: 'none' };

  const api = {
    get source() { return text; },
    get accepted() { return transform(text, 'accepted'); },
    get rejected() { return transform(text, 'rejected'); },
    /** The document before this session — what `rejected` must always equal. */
    get original() { return original; },
    get caret() { return { ...caret }; },
    get history() { return log.slice(); },
    /**
     * What the last action did: `changed` the text, `moved` the caret only
     * (stepping over finished markup), was `blocked`, or found nothing to do.
     * The reference model needs this to know which keystrokes it can predict.
     */
    get last() { return { ...last }; },

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
        if (key === 'ArrowLeft') { caret = moveCaret(text, caret, -1); last = { kind: 'moved' }; log.push('ArrowLeft'); continue; }
        if (key === 'ArrowRight') { caret = moveCaret(text, caret, 1); last = { kind: 'moved' }; log.push('ArrowRight'); continue; }
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
      if (!result) { last = { kind: 'none' }; return api; }
      if (result.blocked) { last = { kind: 'blocked' }; log.push('  (refused)'); return api; }
      if (result.text === undefined) { last = { kind: 'moved' }; caret = result.caret; return api; }
      last = { kind: 'changed', stripped: !!result.stripped };
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

/* ========================================================================== */
/* The reference model                                                        */
/* ========================================================================== */

/**
 * The block marker at the head of the line containing `p` — the `# `, `- `,
 * `1. ` or `> ` — read straight off plain text with a regex.
 *
 * Deliberately a separate reading of structure from `blocks.js`, so the two can
 * be compared rather than assumed equal.
 */
export function blockMarker(text, p) {
  const from = text.lastIndexOf('\n', Math.max(0, p - 1)) + 1;
  const nl = text.indexOf('\n', from);
  const line = text.slice(from, nl < 0 ? text.length : nl);
  const heading = /^#{1,6}[ \t]+/.exec(line);
  if (heading) return { start: from, end: from + heading[0].length, text: heading[0] };
  const item = /^([ \t]*)([-*+][ \t]+|\d{1,9}[.)][ \t]+|>[ \t]?)/.exec(line);
  if (item) return { start: from + item[1].length, end: from + item[0].length, text: item[0] };
  return null;
}

/**
 * A plain text editor: a string, a caret, textbook semantics, no markup.
 *
 * This is the bar the real editor is held to. Everything else in the test suite
 * proves things about the *document* — that it stays well formed, that it can
 * be reverted. None of that says the thing behaves like a text editor, which is
 * the actual requirement and until now lived only in a person's judgement.
 *
 * It is written from scratch rather than by calling into `src/`. That is the
 * whole point: two independent implementations of "what should this keystroke
 * do" that must agree. Reusing `edits.js` here would prove nothing but that the
 * code equals itself.
 *
 * It knows three markdown rules, because they are textbook in every editor that
 * shows formatted prose, and a reference without them would flag correct
 * behaviour as a bug:
 *
 *   - backspace at the start of a block's content removes the whole marker,
 *     not one character of it (`# Heading` must not become `#Heading`)
 *   - nothing else; see `mirror()` for what it declines to predict
 */
export function referenceEditor(initial) {
  let text = initial;
  let caret = { start: 0, end: 0 };

  const at = (p) => ({ start: p, end: p });
  const space = (ch) => /\s/.test(ch);

  /** How far back a single backspace at `p` reaches. */
  const backspaceFrom = (p) => {
    const marker = blockMarker(text, p);
    if (marker && p === marker.end && marker.end > marker.start) return marker.start;
    return p - 1;
  };

  const cut = (from, to, str = '') => {
    text = text.slice(0, from) + str + text.slice(to);
    caret = at(from + str.length);
  };
  const collapsed = () => caret.end <= caret.start;

  const api = {
    get text() { return text; },
    get caret() { return { ...caret }; },
    get marked() { return `${text.slice(0, caret.start)}|${text.slice(caret.start)}`; },

    setText(next) { text = next; return api; },
    setCaret(sel) { caret = { ...sel }; return api; },

    insert(str) {
      cut(caret.start, caret.end, str);
      return api;
    },

    backspace() {
      if (!collapsed()) cut(caret.start, caret.end);
      else if (caret.start > 0) cut(backspaceFrom(caret.start), caret.start);
      return api;
    },

    forwardDelete() {
      if (!collapsed()) cut(caret.start, caret.end);
      else if (caret.start < text.length) cut(caret.start, caret.start + 1);
      return api;
    },

    wordBackward() {
      if (!collapsed()) cut(caret.start, caret.end);
      else cut(api.wordBoundaryBack(caret.start), caret.start);
      return api;
    },

    wordForward() {
      if (!collapsed()) cut(caret.start, caret.end);
      else cut(caret.start, api.wordBoundaryForward(caret.start));
      return api;
    },

    lineBackward() {
      if (!collapsed()) cut(caret.start, caret.end);
      else cut(api.lineBoundaryBack(caret.start), caret.start);
      return api;
    },

    /* The boundaries, exposed so `mirror()` can ask how far a word reaches
       before deciding whether the real editor's answer is comparable. */
    wordBoundaryBack(p) {
      let q = p;
      while (q > 0 && space(text.charAt(q - 1))) q--;
      while (q > 0 && !space(text.charAt(q - 1))) q--;
      return q;
    },
    wordBoundaryForward(p) {
      let q = p;
      while (q < text.length && space(text.charAt(q))) q++;
      while (q < text.length && !space(text.charAt(q))) q++;
      return q;
    },
    lineBoundaryBack(p) {
      let q = p;
      while (q > 0 && text.charAt(q - 1) !== '\n') q--;
      return q;
    },
    /** How many line breaks in a row sit immediately before `p`. */
    blankRunBefore(p) {
      let q = p;
      while (q > 0 && text.charAt(q - 1) === '\n') q--;
      return p - q;
    },
  };

  return api;
}

/**
 * Where source offset `p` lands in the accepted text.
 *
 * Written out here rather than imported so the reference model is checked
 * against an independent reading of the document, not against the same
 * arithmetic that produced the caret in the first place.
 */
export function acceptedOffset(source, p) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
  let acc = 0;
  for (const t of tokenize(source)) {
    if (p <= t.start) return acc;
    const inside = p < t.end;
    if (t.type === 'plain') {
      if (inside) return acc + (p - t.start);
      acc += t.end - t.start;
    } else if (t.type === 'ins' || t.type === 'hl') {
      if (inside) return acc + clamp(p - (t.start + 3), 0, t.a.length);
      acc += t.a.length;
    } else if (t.type === 'sub') {
      if (inside) return acc + clamp(p - (t.start + 3 + t.a.length + 2), 0, t.b.length);
      acc += t.b.length;
    } else if (inside) {
      return acc;              // inside a deletion or a comment: contributes nothing
    }
  }
  return acc;
}

/**
 * The real editor, shadowed by the reference one, fed the same keystrokes.
 *
 * After every keystroke two things must hold:
 *
 *   ed.accepted === ref.text     the edit did what a normal editor does
 *   ed.rejected === ed.original  and the original is still recoverable
 *
 * The second is the existing invariant. The first is the new one, and it turns
 * "does this behave like a text editor" from a judgement call into a failing
 * test. The caret is checked too, in accepted coordinates — a caret that drifts
 * is how one wrong keystroke becomes a corrupted paragraph three keystrokes
 * later.
 *
 * Some keystrokes have no plain-text answer, and the mirror says so rather than
 * inventing one. Each is recorded in `skipped`, and the reference is re-synced
 * from the real document so checking resumes on the next keystroke:
 *
 *   - **Enter that is not a bare newline.** A markdown paragraph break is two
 *     newlines and continuing a list is not a text operation at all. Scoped
 *     out deliberately; `structure.test.js` and `editor.test.js` own it.
 *   - **Arrow keys.** Caret movement across markup is ours to drive by design —
 *     one press steps over a whole deletion, which in the accepted text is a
 *     move of zero characters.
 *   - **Word and line deletes clamped by markup.** These stop at the edge of
 *     the surrounding plain run rather than swallowing an existing annotation.
 *   - **Backspace against a run of blank lines.** How much of the run goes
 *     depends on whether it is part of the change in flight.
 *   - **Backspace where the screen and the accepted text disagree about where
 *     a block marker ends.** Structure is read off the screen by design.
 *   - **Anything the editor refused,** stepped over, or sanitised.
 */
export function mirror(initial, options = {}) {
  const ed = editor(initial, options);
  const ref = referenceEditor(ed.accepted);
  const skipped = [];
  const trail = [];
  let divergence = null;

  const acceptedCaret = () => ({
    start: acceptedOffset(ed.source, ed.caret.start),
    end: acceptedOffset(ed.source, ed.caret.end),
  });

  const resync = (why) => {
    skipped.push(why);
    ref.setText(ed.accepted).setCaret(acceptedCaret());
  };

  const diverge = (what, field, real, expected) => {
    divergence = {
      what,
      field,
      real,
      expected,
      trail: trail.slice(),
      source: ed.source,
      message: `after ${trail.join(' → ')}\n  ${field}: editor ${JSON.stringify(real)}\n  ${' '.repeat(field.length)}  plain  ${JSON.stringify(expected)}\n  source: ${JSON.stringify(ed.source)}`,
    };
  };

  const compare = (what) => {
    if (divergence) return;
    if (ed.accepted !== ref.text) return diverge(what, 'text', ed.accepted, ref.text);
    const here = acceptedCaret();
    if (here.start !== ref.caret.start) return diverge(what, 'caret', here.start, ref.caret.start);
  };

  /** The reference's version of a keystroke, or null when it has no opinion. */
  const plainMeaning = (key) => {
    const src = ed.source;
    const sel = ed.caret;
    const collapsed = sel.end <= sel.start;
    const [lo, hi] = plainRun(parse(src), sel.start);
    const runStart = acceptedOffset(src, lo);
    const runEnd = acceptedOffset(src, Math.min(hi, src.length));
    const from = ref.caret.start;

    switch (key) {
      case 'Enter':
        return paragraphBreak(src, sel, 'rendered') === '\n' ? () => ref.insert('\n') : null;
      case 'Backspace': {
        if (!collapsed) return () => ref.backspace();
        // A run of blank lines is one block separator, and whether backspace
        // takes one newline or the whole run depends on whether the run is part
        // of the change in flight — you undo your own Enter one press at a
        // time, but you join two existing blocks in one. Structure, not text.
        if (ref.blankRunBefore(from) > 1) return null;
        // The editor reads structure off the screen, where a change still shows
        // both halves; the reference only ever sees the accepted text. Where
        // they disagree about whether this caret sits at a marker's end, the
        // marker itself is mid-change and the reference has no standing.
        const screen = toVisible(src);
        const atEnd = (m, p) => !!m && m.end === p && m.end > m.start;
        if (atEnd(blockMarker(screen.text, toVisibleOffset(screen, sel.start)), toVisibleOffset(screen, sel.start))
            !== atEnd(blockMarker(ref.text, from), from)) return null;
        return () => ref.backspace();
      }
      case 'Delete':
        return () => ref.forwardDelete();
      case 'Alt+Backspace':
        if (!collapsed) return () => ref.wordBackward();
        return ref.wordBoundaryBack(from) >= runStart ? () => ref.wordBackward() : null;
      case 'Alt+Delete':
        if (!collapsed) return () => ref.wordForward();
        return ref.wordBoundaryForward(from) <= runEnd ? () => ref.wordForward() : null;
      case 'Cmd+Backspace':
        if (!collapsed) return () => ref.lineBackward();
        return ref.lineBoundaryBack(from) >= runStart ? () => ref.lineBackward() : null;
      default:
        return null;                       // the arrows, and anything unnamed
    }
  };

  /** Apply one keystroke to both, or to the real one alone and re-sync. */
  const step = (label, real, plain) => {
    if (divergence) return api;
    trail.push(label);
    real();
    const outcome = ed.last;
    if (!plain) resync(`${label}: no plain-text meaning`);
    else if (outcome.kind === 'blocked') resync(`${label}: refused`);
    else if (outcome.kind === 'moved') resync(`${label}: stepped over markup`);
    else if (outcome.stripped) resync(`${label}: delimiters stripped`);
    else { plain(); compare(label); }
    return api;
  };

  const api = {
    ed,
    ref,
    /** Null while the two agree; otherwise what they disagreed about. */
    get divergence() { return divergence; },
    /** Keystrokes the reference declined to predict, with the reason. */
    get skipped() { return skipped.slice(); },
    get trail() { return trail.slice(); },

    type(str) {
      for (const ch of str) {
        step(`type ${JSON.stringify(ch)}`, () => ed.act({ type: 'insertText', data: ch }), () => ref.insert(ch));
      }
      return api;
    },

    press(key, times = 1) {
      for (let i = 0; i < times; i++) step(key, () => ed.press(key), plainMeaning(key));
      return api;
    },

    /** Move or select without editing; the reference simply follows. */
    place(label, fn) {
      trail.push(label);
      fn(ed);
      ref.setCaret(acceptedCaret());
      return api;
    },
    select(needle) { return api.place(`select ${JSON.stringify(needle)}`, (e) => e.select(needle)); },
    caretBefore(needle) { return api.place(`caretBefore ${JSON.stringify(needle)}`, (e) => e.caretBefore(needle)); },
    caretAfter(needle) { return api.place(`caretAfter ${JSON.stringify(needle)}`, (e) => e.caretAfter(needle)); },
    caretAt(offset) { return api.place(`caretAt ${offset}`, (e) => e.caretAt(offset)); },
    caretAtEnd() { return api.place('caretAtEnd', (e) => e.caretAtEnd()); },
  };

  return api;
}
