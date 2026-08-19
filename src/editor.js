/**
 * What a keystroke does to the document.
 *
 * This is the single source of truth for editor semantics, and it is pure:
 * (text, caret, view) in, (text, caret) out. `input.js` translates browser
 * events into these actions and does nothing else; the test harness drives the
 * very same functions without a browser.
 *
 * Keeping this DOM-free is what makes editor behaviour testable at all. It used
 * to be spread across an event handler and a couple of callbacks, so the only
 * way to ask "what does Enter do here?" was to press Enter and look.
 */

import * as edits from './edits.js';
import { parseBlocks, blockAt } from './blocks.js';

/** @typedef {{text:string, caret:{start:number,end:number}, view:string}} EditorState */

const collapsed = (sel) => sel.end <= sel.start;

/**
 * The string Enter should insert.
 *
 * Inside a list, continue the list. Splitting a block needs a full break;
 * sitting at a boundary already needs a single newline, or every press opens
 * two blank lines at once. The boundary test reads block structure rather than
 * the preceding character, because after an edit the caret often sits just past
 * a closing delimiter — not a newline, but very much a line boundary.
 */
export function paragraphBreak(text, caret, view) {
  if (view !== 'rendered') return '\n';
  const at = caret.start;
  const block = blockAt(parseBlocks(text), at);
  if (block && block.type === 'listItem') {
    const marker = text.slice(block.markerStart, block.contentStart);
    return `\n${' '.repeat(block.indent || 0)}${block.ordered ? '1. ' : marker.trimStart()}`;
  }
  const atBoundary = !block || block.type === 'blank' || at <= block.contentStart;
  return atBoundary ? '\n' : '\n\n';
}

/**
 * The run of line breaks backspace should remove to join this block to the one
 * above. Removing half a blank line changes nothing anyone can see.
 */
export function blockJoinBefore(text, caret, view) {
  if (view !== 'rendered') return null;   // in Source, newlines are visible characters
  const at = caret.start;
  let start = at;
  while (start > 0 && text.charAt(start - 1) === '\n') start--;
  return start < at ? { start, end: at } : null;
}

/**
 * Apply one editing action.
 *
 * @param {EditorState} state
 * @param {{type:string, data?:string, dir?:number}} action
 * @returns {null | {blocked:object} | {text?:string, caret:object, coalesce?:string|null, stripped?:boolean}}
 */
export function applyAction(state, action) {
  const { text, caret, view } = state;
  const sel = caret;

  switch (action.type) {
    case 'insertText':
      return edits.insert(text, sel, action.data || '');

    case 'insertParagraph':
      return edits.insert(text, sel, paragraphBreak(text, sel, view));

    case 'insertLineBreak':
      return edits.insert(text, sel, '\n');

    case 'paste':
      return action.data ? edits.insert(text, sel, action.data) : null;

    case 'deleteBackward': {
      if (!collapsed(sel)) return edits.deleteRange(text, sel, 'back');
      const join = blockJoinBefore(text, sel, view);
      return join ? edits.deleteRange(text, join, 'back') : edits.deleteBackward(text, sel.start);
    }

    case 'deleteForward':
      return collapsed(sel) ? edits.deleteForward(text, sel.start) : edits.deleteRange(text, sel, 'fwd');

    case 'deleteWordBackward':
      return collapsed(sel) ? edits.deleteWordBackward(text, sel.start) : edits.deleteRange(text, sel, 'back');

    case 'deleteWordForward':
      return collapsed(sel) ? edits.deleteWordForward(text, sel.start) : edits.deleteRange(text, sel, 'fwd');

    case 'deleteLineBackward':
      return collapsed(sel) ? edits.deleteLineBackward(text, sel.start) : edits.deleteRange(text, sel, 'back');

    default:
      return null;
  }
}

/**
 * Where the caret goes on an arrow press, ignoring what is on screen.
 *
 * The rendered view has a second constraint this cannot see — some source
 * offsets have no position on screen at all — so the app consults its offset
 * index first and falls back to this.
 */
export function moveCaret(text, caret, dir) {
  const at = caret.end > caret.start ? (dir < 0 ? caret.start : caret.end) : caret.start;
  if (caret.end > caret.start) return { start: at, end: at };
  const target = edits.stepCaret(text, at, dir);
  return { start: target, end: target };
}
