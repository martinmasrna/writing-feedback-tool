/**
 * Input interception.
 *
 * The document is `contenteditable`, but the browser is never allowed to mutate
 * it. Every `beforeinput` is cancelled and translated into an operation on the
 * markdown source instead, which is then re-rendered. That is what lets ordinary
 * typing and backspacing produce tracked CriticMarkup.
 */

import { applyAction, moveCaret } from './editor.js';

/**
 * @param {(sel:{start,end}) => any} read      current selection in source offsets
 * @param {(result:any) => string}   apply     hand a result to the store
 */
export function attachInput(doc, { read, apply, getText, getView, canEdit, undo, redo, onComposedRender, setCaret, stepInView, onTab }) {
  doc.addEventListener('beforeinput', (e) => {
    if (!canEdit()) { e.preventDefault(); return; }
    // Composition is handled at compositionend; cancelling it here breaks IME.
    if (e.inputType === 'insertCompositionText') return;

    e.preventDefault();
    const sel = read();
    if (!sel) return;
    const state = { text: getText(), caret: sel, view: getView() };

    switch (e.inputType) {
      case 'insertText':        apply(applyAction(state, { type: 'insertText', data: e.data || '' })); break;
      case 'insertParagraph':   apply(applyAction(state, { type: 'insertParagraph' })); break;
      case 'insertLineBreak':   apply(applyAction(state, { type: 'insertLineBreak' })); break;
      case 'insertFromPaste':
      case 'insertFromDrop':
      case 'insertReplacementText': {
        const data = e.dataTransfer ? e.dataTransfer.getData('text/plain') : e.data || '';
        apply(applyAction(state, { type: 'paste', data }));
        break;
      }
      case 'deleteContentBackward':     apply(applyAction(state, { type: 'deleteBackward' })); break;
      case 'deleteContentForward':      apply(applyAction(state, { type: 'deleteForward' })); break;
      case 'deleteWordBackward':        apply(applyAction(state, { type: 'deleteWordBackward' })); break;
      case 'deleteWordForward':         apply(applyAction(state, { type: 'deleteWordForward' })); break;
      case 'deleteSoftLineBackward':
      case 'deleteHardLineBackward':    apply(applyAction(state, { type: 'deleteLineBackward' })); break;
      case 'deleteSoftLineForward':
      case 'deleteHardLineForward':
      case 'deleteEntireSoftLine':      apply(applyAction(state, { type: 'deleteLineForward' })); break;
      // Cut and drag-out. Every `beforeinput` here is cancelled, so anything
      // this switch does not name is a keystroke that silently does nothing —
      // ⌘X used to put the selection on the clipboard and leave it in the
      // document, which is a copy, not a cut.
      case 'deleteByCut':
      case 'deleteByDrag':
      case 'deleteContent':             apply(applyAction(state, { type: 'deleteSelection' })); break;
      case 'historyUndo':               undo(); break;
      case 'historyRedo':               redo(); break;
      default: break;
    }
  });

  // Arrow keys have to be driven by hand. The browser will not move the caret
  // across a contenteditable="false" span, so a press beside struck text does
  // nothing and the next keystroke lands in the wrong place.
  doc.addEventListener('keydown', (e) => {
    if (!canEdit()) return;
    if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey && onTab) {
      e.preventDefault();
      onTab(e.shiftKey);
      return;
    }
    // Up/Down is a layout question — which line is below this pixel. Chrome's
    // own key handling answers it unreliably around an empty block (a bullet,
    // the invisible blank-line separator): the same keystroke, on a page with
    // none of this app's code running, has been seen to land correctly, skip
    // the block, or drop the caret out of the editable region entirely. So
    // Up/Down is driven by hand too, but via the browser's own layout
    // (`offsets.vertical`, using `caretRangeFromPoint`) rather than either
    // trusting the native key handling or reimplementing line-splitting by
    // counting `\n` characters, which is blind to word-wrap.
    const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
    if (!vertical && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;   // word/line/selection: leave alone

    const sel = read();
    if (!sel) return;
    const dir = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;

    // A collapsed caret steps; a selection collapses to the edge you moved toward.
    // The rendered view knows about positions that do not exist on screen;
    // ask it first, and fall back to the view-independent rule.
    const text = getText();
    const from = sel.end > sel.start ? (dir < 0 ? sel.start : sel.end) : sel.start;
    const inView = sel.end > sel.start ? null : (stepInView ? stepInView(from, dir, vertical ? 'vertical' : 'horizontal') : null);
    const next = inView !== null && inView !== undefined
      ? { start: inView, end: inView }
      : moveCaret(text, sel, dir);
    if (next.start === sel.start && next.end === sel.end) return;   // already at the end

    e.preventDefault();
    setCaret(next);
  });

  // IME: let the browser compose freely, then discard its DOM edit and apply the
  // composed string through the same path as everything else — `applyAction`,
  // not `edits.insert`. Composition can start over a selection, and going
  // straight to the edit engine skipped the guard that keeps a selection
  // spanning a code fence from swallowing it.
  let composingAt = null;
  doc.addEventListener('compositionstart', () => { composingAt = read(); });
  doc.addEventListener('compositionend', (e) => {
    const at = composingAt;
    composingAt = null;
    if (!at) return;
    onComposedRender();
    if (e.data) apply(applyAction({ text: getText(), caret: at, view: getView() }, { type: 'insertText', data: e.data }));
  });
}

/**
 * Global shortcuts. Plain letters are typing now, so every command needs a
 * modifier: ⌘Z / ⇧⌘Z, ⌘S, and ⌘⌥M to comment on a selection.
 */
export function attachShortcuts({ undo, redo, save, comment, escape, dialogOpen, commands = {} }) {
  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    if (mod && !e.altKey && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (mod && key === 's') { e.preventDefault(); save(); return; }
    if (mod && e.altKey && key === 'm') { e.preventDefault(); comment(); return; }
    if (mod && e.altKey && key === 'r' && commands.reasons) { e.preventDefault(); commands.reasons(); return; }

    // Structural commands, in the register people already know.
    //
    // Match on e.code, not e.key: with Shift held, the 8 key reports '*' and
    // the 7 key '&' on a US layout, and Alt reports dead keys and symbols on
    // most layouts. e.code is the physical key and is layout-independent.
    const digit = /^Digit([0-9])$/.exec(e.code);

    if (mod && !e.altKey && key === 'b' && commands.bold) { e.preventDefault(); commands.bold(); return; }
    if (mod && !e.altKey && key === 'i' && commands.italic) { e.preventDefault(); commands.italic(); return; }
    if (mod && e.shiftKey && !e.altKey && digit && digit[1] === '8' && commands.bullet) {
      e.preventDefault(); commands.bullet(); return;
    }
    if (mod && e.shiftKey && !e.altKey && digit && digit[1] === '7' && commands.numbered) {
      e.preventDefault(); commands.numbered(); return;
    }
    if (mod && e.altKey && digit && Number(digit[1]) <= 6 && commands.heading) {
      e.preventDefault();
      commands.heading(Number(digit[1]));
      return;
    }
    if (dialogOpen()) return;
    if (e.key === 'Escape') escape();
  });
}
