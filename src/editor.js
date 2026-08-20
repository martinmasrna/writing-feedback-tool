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
import { parseBlocks, blockFor } from './blocks.js';
import { toVisible, toVisibleOffset, toSourceRange } from './visible.js';

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
  const block = blockFor(text, at);
  if (block && block.type === 'listItem') {
    // In front of the marker, Enter opens a line above the item. Starting a
    // second item there puts both markers on one line — `1. 1. Heading` — which
    // is not a list of two things and not what anybody meant.
    if (toVisibleOffset(toVisible(text), at) <= block.visible.markerStart) return '\n';
    const marker = text.slice(block.markerStart, block.contentStart);
    const next = `${' '.repeat(block.indent || 0)}${block.ordered ? '1. ' : marker.trimStart()}`;
    // Past the end of the item we are already on a fresh line; adding another
    // break would leave a blank line between the two bullets.
    return caret.start > block.end ? next : `\n${next}`;
  }
  const atBoundary = !block || block.type === 'blank' || at <= block.contentStart;
  return atBoundary ? '\n' : '\n\n';
}

/**
 * The block marker backspace should remove when the caret sits at the very
 * start of a block's content.
 *
 * Deleting one character there strips the space out of `# ` or `- `, leaving
 * `#Heading` — not a heading any more, and not valid markdown either. Every
 * editor removes the whole marker instead, turning the block back into body
 * text. Only in the rendered view: in Source the marker is visible text and
 * backspace should behave literally.
 */
export function markerBefore(text, caret, view) {
  if (view !== 'rendered') return null;
  const block = blockFor(text, caret.start);
  if (!block || block.markerStart === undefined) return null;
  if (block.visible.contentStart <= block.visible.markerStart) return null;

  // Both comparisons are made on screen rather than in the source, because the
  // source offsets lie whenever markup is in the way. When a block's content
  // begins with an annotation the caret can only stand *before* the opening
  // delimiter, several characters short of the mapped contentStart — and a
  // marker that is itself part of a change ends where its text ends, not where
  // the next visible character happens to come from.
  const visible = toVisible(text);
  if (toVisibleOffset(visible, caret.start) !== block.visible.contentStart) return null;
  return toSourceRange(visible, block.visible.markerStart, block.visible.markerEnd);
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
 * The unsupported block a selection would swallow, if any.
 *
 * Code fences, tables and raw HTML are rendered as read-only islands, so the
 * caret cannot get inside one — but a selection dragged from above to below one
 * used to take it along, burying the whole block inside a substitution. The
 * text survived, but the island vanished from the screen and the document
 * collapsed around it. We refuse to mangle what we do not fully parse, and that
 * has to hold for ordinary typing, not only for the structural commands.
 */
export function crossesUnsupported(text, sel) {
  if (collapsed(sel)) {
    const here = blockFor(text, sel.start);
    return here && here.type === 'unsupported' && sel.start > here.start && sel.start < here.end ? here : null;
  }
  return parseBlocks(text).find((b) => b.type === 'unsupported' && sel.start < b.end && sel.end > b.start) || null;
}

const MUTATING = new Set([
  'insertText', 'insertParagraph', 'insertLineBreak', 'paste',
  'deleteBackward', 'deleteForward', 'deleteWordBackward', 'deleteWordForward',
  'deleteLineBackward', 'deleteLineForward', 'deleteSelection',
]);

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

  if (MUTATING.has(action.type)) {
    const island = crossesUnsupported(text, sel);
    // The Source view is where islands are edited — that is the whole reason it
    // exists, and refusing there left the documented escape hatch shut. Every
    // character is on screen and editable, so an edit that stays inside one is
    // the user changing exactly what they can see.
    //
    // A range that reaches across an island's boundary is still refused, in
    // either view: striking one out makes `splitLines` stop seeing the line
    // breaks inside it, the fence stops being a fence, and the document
    // collapses around it when you switch back.
    const escapes = sel.start < island?.start || sel.end > island?.end;
    if (island && (view !== 'source' || escapes)) {
      return { blocked: { kind: 'unsupported', reason: island.reason } };
    }
  }

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
      // At the head of a block, take the whole marker rather than a character of it.
      const marker = markerBefore(text, sel, view);
      if (marker) {
        const removed = edits.removeMarker(text, marker);
        if (removed && !removed.blocked) return removed;
      }
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

    case 'deleteLineForward':
      return collapsed(sel) ? edits.deleteLineForward(text, sel.start) : edits.deleteRange(text, sel, 'fwd');

    // Cutting, and dragging text out of the document, delete a selection and
    // nothing else: with no selection there is nothing to take.
    case 'deleteSelection':
      return collapsed(sel) ? null : edits.deleteRange(text, sel, 'back');

    default:
      return null;
  }
}

/**
 * Annotate a selection deliberately — the floating toolbar's Replace, Delete
 * and Comment.
 *
 * `edits.annotate` refuses to overlap another annotation but knows nothing
 * about block structure, and this is the third door into the same bug: a
 * selection dragged from above a code fence to below it went straight into a
 * substitution. The text survived in the source, but the island vanished from
 * the screen and the document collapsed around it. Typing and the structural
 * commands were both guarded; this way in was not.
 *
 * Only the destructive two are refused. A highlight keeps every character where
 * it is — the island still draws, and accepting or rejecting leaves the fence
 * untouched — so commenting on a code block stays possible, which in a review
 * tool is the whole point of having one.
 */
export function annotate(text, sel, kind, replacement, reason) {
  if (kind === 'sub' || kind === 'del') {
    const island = crossesUnsupported(text, sel);
    if (island) return { blocked: { kind: 'unsupported', reason: island.reason } };
  }
  return edits.annotate(text, sel, kind, replacement, reason);
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
