/**
 * Input interception.
 *
 * The document is `contenteditable`, but the browser is never allowed to mutate
 * it. Every `beforeinput` is cancelled and translated into an operation on the
 * markdown source instead, which is then re-rendered. That is what lets ordinary
 * typing and backspacing produce tracked CriticMarkup.
 */

import * as edits from './edits.js';

/**
 * @param {(sel:{start,end}) => any} read      current selection in source offsets
 * @param {(result:any) => string}   apply     hand a result to the store
 */
export function attachInput(doc, { read, apply, getText, canEdit, undo, redo, onComposedRender, paragraphBreak, setCaret }) {
  doc.addEventListener('beforeinput', (e) => {
    if (!canEdit()) { e.preventDefault(); return; }
    // Composition is handled at compositionend; cancelling it here breaks IME.
    if (e.inputType === 'insertCompositionText') return;

    e.preventDefault();
    const sel = read();
    if (!sel) return;
    const text = getText();
    const caret = sel.start;

    switch (e.inputType) {
      case 'insertText':
        apply(edits.insert(text, sel, e.data || ''));
        break;
      case 'insertParagraph':
        apply(edits.insert(text, sel, paragraphBreak ? paragraphBreak() : '\n'));
        break;
      case 'insertLineBreak':
        apply(edits.insert(text, sel, '\n'));
        break;
      case 'insertFromPaste':
      case 'insertFromDrop':
      case 'insertReplacementText': {
        const data = e.dataTransfer ? e.dataTransfer.getData('text/plain') : e.data || '';
        if (data) apply(edits.insert(text, sel, data));
        break;
      }
      case 'deleteContentBackward':
        apply(sel.end > sel.start ? edits.deleteRange(text, sel, 'back') : edits.deleteBackward(text, caret));
        break;
      case 'deleteContentForward':
        apply(sel.end > sel.start ? edits.deleteRange(text, sel, 'fwd') : edits.deleteForward(text, caret));
        break;
      case 'deleteWordBackward':
        apply(sel.end > sel.start ? edits.deleteRange(text, sel, 'back') : edits.deleteWordBackward(text, caret));
        break;
      case 'deleteWordForward':
        apply(sel.end > sel.start ? edits.deleteRange(text, sel, 'fwd') : edits.deleteWordForward(text, caret));
        break;
      case 'deleteSoftLineBackward':
      case 'deleteHardLineBackward':
        apply(sel.end > sel.start ? edits.deleteRange(text, sel, 'back') : edits.deleteLineBackward(text, caret));
        break;
      case 'historyUndo':
        undo();
        break;
      case 'historyRedo':
        redo();
        break;
      default:
        break;
    }
  });

  // Arrow keys have to be driven by hand. The browser will not move the caret
  // across a contenteditable="false" span, so a press beside struck text does
  // nothing and the next keystroke lands in the wrong place.
  doc.addEventListener('keydown', (e) => {
    if (!canEdit()) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;   // word/line/selection: leave alone

    const sel = read();
    if (!sel) return;
    const dir = e.key === 'ArrowLeft' ? -1 : 1;

    // A collapsed caret steps; a selection collapses to the edge you moved toward.
    const from = sel.end > sel.start ? (dir < 0 ? sel.start : sel.end) : sel.start;
    const target = sel.end > sel.start ? from : edits.stepCaret(getText(), from, dir);
    if (target === sel.start && target === sel.end) return;         // already at the end of the document

    e.preventDefault();
    setCaret({ start: target, end: target });
  });

  // IME: let the browser compose freely, then discard its DOM edit and apply the
  // composed string through the same path as everything else.
  let composingAt = null;
  doc.addEventListener('compositionstart', () => { composingAt = read(); });
  doc.addEventListener('compositionend', (e) => {
    const at = composingAt;
    composingAt = null;
    if (!at) return;
    onComposedRender();
    if (e.data) apply(edits.insert(getText(), at, e.data));
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
