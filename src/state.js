/**
 * The document store: the markdown text, its history, and the caret.
 *
 * The annotated markdown is the whole state — annotations are re-derived from it
 * rather than stored alongside it, so the file on disk and the UI can never
 * disagree.
 */

import { parse } from './criticmarkup.js';
import { normalize, preservesOriginal } from './edits.js';

const HISTORY_LIMIT = 400;
/** Keystrokes of the same kind within this window collapse into one undo step. */
const COALESCE_MS = 900;

export function createStore() {
  const listeners = new Set();

  const state = {
    text: '',
    saved: '',
    name: '',
    handle: null,
    loaded: false,
    view: 'rendered',
    caret: null,
    /** Start offset of the annotation currently being typed into, if any. */
    activeStart: null,
    anns: [],
    undo: [],
    redo: [],
  };

  let lastKind = null;
  let lastAt = 0;

  const reparse = () => { state.anns = parse(state.text); };
  const emit = () => { for (const fn of listeners) fn(state); };

  function pushHistory(kind) {
    const now = Date.now();
    const merge = kind && kind === lastKind && now - lastAt < COALESCE_MS && state.undo.length > 0;
    if (!merge) {
      state.undo.push({ text: state.text, caret: state.caret });
      if (state.undo.length > HISTORY_LIMIT) state.undo.shift();
    }
    state.redo.length = 0;
    lastKind = kind || null;
    lastAt = now;
  }

  /** The annotation the caret is sitting in, if any — preferring containment. */
  function trackActive() {
    if (!state.caret) { state.activeStart = null; return; }
    const p = state.caret.start;
    let inside = null, starts = null, ends = null;
    for (const a of state.anns) {
      if (p > a.start && p < a.end) inside = a;
      else if (p === a.start && !starts) starts = a;
      else if (p === a.end && !ends) ends = a;
    }
    const pick = inside || starts || ends;
    state.activeStart = pick ? pick.start : null;
  }

  const store = {
    get state() { return state; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    load(text, name, handle) {
      state.text = text.replace(/\r\n?/g, '\n');   // including the lone CR of very old files
      state.saved = state.text;
      state.name = name || 'untitled.md';
      state.handle = handle || null;
      state.loaded = true;
      state.view = 'rendered';
      state.caret = null;
      state.activeStart = null;
      state.undo = [];
      state.redo = [];
      lastKind = null;
      reparse();
      emit();
    },

    /**
     * Apply a result from the edit engine.
     * @returns {'applied'|'moved'|'blocked'|'unsafe'|'noop'}
     */
    apply(result) {
      if (!result) return 'noop';
      if (result.blocked) return 'blocked';
      if (result.text === undefined) {
        state.caret = result.caret;
        trackActive();
        emit();
        return 'moved';
      }
      // Collapse edits that undo each other before they reach the document.
      const settled = normalize(result.text, result.caret);
      // And never let one through that changes the document underneath the
      // annotations. Every edit preserves it by construction, so one that does
      // not has broken the markup rather than extended it.
      if (!preservesOriginal(state.text, settled.text)) return 'unsafe';
      pushHistory(result.coalesce);
      state.text = settled.text;
      state.caret = settled.caret;
      reparse();
      trackActive();
      emit();
      return 'applied';
    },

    setCaret(caret) {
      state.caret = caret;
      trackActive();
    },
    clearActive() { state.activeStart = null; },

    activeAnnotation() {
      if (state.activeStart === null) return null;
      return state.anns.find((a) => a.start === state.activeStart) || null;
    },

    undo() {
      if (!state.undo.length) return false;
      const prev = state.undo.pop();
      state.redo.push({ text: state.text, caret: state.caret });
      state.text = prev.text;
      state.caret = prev.caret;
      lastKind = null;
      state.activeStart = null;
      reparse();
      emit();
      return true;
    },

    redo() {
      if (!state.redo.length) return false;
      const next = state.redo.pop();
      state.undo.push({ text: state.text, caret: state.caret });
      state.text = next.text;
      state.caret = next.caret;
      lastKind = null;
      state.activeStart = null;
      reparse();
      emit();
      return true;
    },

    setView(view) { state.view = view; emit(); },
    markSaved(name, handle) {
      state.saved = state.text;
      if (name) state.name = name;
      if (handle) state.handle = handle;
      emit();
    },
    dirty() { return state.loaded && state.text !== state.saved; },
    /** Force a re-render without changing anything (used after transient UI edits). */
    refresh() { reparse(); emit(); },
  };

  return store;
}
