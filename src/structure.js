/**
 * Structural edits: bullets, heading levels, emphasis.
 *
 * These are the operations that change *what a block is* rather than what it
 * says, and they are tracked like everything else — adding a bullet inserts
 * `{++- ++}`, removing one wraps the marker in `{--- --}`. Because we parse
 * block structure ourselves, a marker that is mid-change still renders as a
 * marker, tinted to show which way it is going.
 *
 * Undoing your own structural change removes the annotation outright rather
 * than nesting one inside another — the same principle as backspacing over
 * text you just typed.
 *
 * Pure: source and caret in, source and caret out.
 */

import { parseBlocks, blockAt } from './blocks.js';
import { parse, regionAt } from './criticmarkup.js';

const splice = (text, a, b, ins) => text.slice(0, a) + ins + text.slice(b);

/** Keep a caret pointing at the same character across an edit at `at`. */
function shift(caret, at, delta) {
  if (!caret) return caret;
  const move = (p) => (p >= at ? p + delta : p);
  return { start: move(caret.start), end: move(caret.end) };
}

/** Start of the raw source line containing `offset`. */
function lineStart(text, offset) {
  const nl = text.lastIndexOf('\n', Math.max(0, offset - 1));
  return nl < 0 ? 0 : nl + 1;
}

const MARKER = /^\s*([-*+]|\d{1,9}[.)]|#{1,6})\s+$/;

/**
 * The tracked change a block marker currently sits inside, if any.
 *
 * Offsets cannot be compared directly here: `{++- ++}` puts the marker at 3..5
 * while the block's contentStart is 8, on the far side of the closing
 * delimiter. So we ask which annotation *contains* the marker and whether its
 * body looks like one.
 */
function markerAnnotation(text, offset) {
  for (const a of parse(text)) {
    if (a.type !== 'ins' && a.type !== 'del') continue;
    if (offset < a.tok.start + 3 || offset >= a.tok.end - 3) continue;
    if (MARKER.test(a.a)) return a;
  }
  return null;
}

/** Drop a tracked marker change, leaving the text as if it never happened. */
function revert(text, caret, a) {
  const keep = a.type === 'del' ? a.a : '';       // restore a struck marker; erase an added one
  const delta = keep.length - (a.end - a.start);
  return { text: splice(text, a.start, a.end, keep), caret: shift(caret, a.end, delta), coalesce: null };
}

/** Refuse to touch anything we do not fully understand. */
function guard(text, caret) {
  const blocks = parseBlocks(text);
  const block = blockAt(blocks, caret.start);
  if (!block) return { error: 'no block' };
  if (block.type === 'unsupported') return { error: 'unsupported' };
  return { blocks, block };
}

/* -------------------------------------------------------------------------- */
/* Block markers                                                               */
/* -------------------------------------------------------------------------- */

/** A block's marker — the `- `, `1. `, `## ` or `> ` — or null for a paragraph. */
function markerOf(text, block) {
  if (block.markerStart === undefined || block.contentStart <= block.markerStart) return null;
  return {
    start: block.markerStart,
    end: block.contentStart,
    text: text.slice(block.markerStart, block.contentStart),
  };
}

/**
 * Give a block a different marker, tracked. `next` of `''` removes it.
 *
 * Block types are exclusive, as they are in every other editor: making a bullet
 * into a heading stops it being a bullet. Stacking the markers instead produced
 * `- ## Title`, which is legal markdown for a list item containing a heading
 * and never what anybody meant.
 */
function applyMarker(text, caret, block, next) {
  const marker = markerOf(text, block);
  const mine = marker ? markerAnnotation(text, marker.start) : null;
  const rewrite = (from, to, md, oldLength) => ({
    text: splice(text, from, to, md),
    caret: shift(caret, to, md.length - oldLength),
    coalesce: null,
  });

  // A marker already mid-change is rewritten in place, never nested inside a
  // second annotation.
  if (mine) {
    if (!next) return revert(text, caret, mine);
    const md = mine.type === 'ins' ? `{++${next}++}` : `{~~${mine.a}~>${next}~~}`;
    return rewrite(mine.start, mine.end, md, mine.end - mine.start);
  }

  if (!marker) {
    if (!next) return null;
    const at = lineStart(text, caret.start);
    const md = `{++${next}++}`;
    return { text: splice(text, at, at, md), caret: shift(caret, at, md.length), coalesce: null };
  }

  if (regionAt(parse(text), marker.start).kind === 'atomic') return { blockedReason: 'markup' };
  if (marker.text === next) return null;
  const md = next ? `{~~${marker.text}~>${next}~~}` : `{--${marker.text}--}`;
  return rewrite(marker.start, marker.end, md, marker.text.length);
}

/** Blocks that have no marker to change and no content to carry one. */
const MARKERLESS = new Set(['rule', 'blank', 'unsupported']);

/**
 * Turn a block into a list item, or a list item back into a paragraph.
 * Asking for the kind of list it already is toggles it off; asking for the
 * other kind converts between them.
 */
export function toggleBullet(text, caret, opts = {}) {
  const g = guard(text, caret);
  if (g.error) return g.error === 'unsupported' ? { blockedReason: 'unsupported' } : null;
  const { block } = g;
  if (MARKERLESS.has(block.type)) return null;

  const wantOrdered = !!opts.ordered;
  const marker = wantOrdered ? '1. ' : '- ';
  if (block.type === 'listItem') {
    const alreadyThisKind = !!block.ordered === wantOrdered;
    return applyMarker(text, caret, block, alreadyThisKind ? '' : marker);
  }
  return applyMarker(text, caret, block, marker);
}

/** Set the heading level of the block at the caret. Level 0 makes it body text. */
export function setHeadingLevel(text, caret, level) {
  const g = guard(text, caret);
  if (g.error) return g.error === 'unsupported' ? { blockedReason: 'unsupported' } : null;
  const { block } = g;
  if (MARKERLESS.has(block.type)) return null;

  if (level === 0) return block.type === 'heading' ? applyMarker(text, caret, block, '') : null;
  if (block.type === 'heading' && block.level === level) return null;
  return applyMarker(text, caret, block, `${'#'.repeat(level)} `);
}

/* -------------------------------------------------------------------------- */
/* Emphasis                                                                    */
/* -------------------------------------------------------------------------- */

const WIDTH = { strong: '**', em: '*' };

/**
 * Wrap a selection in bold or italic, or unwrap it when it already is.
 * Written as one substitution so it reads as a single tracked change.
 */
export function toggleEmphasis(text, sel, kind = 'strong') {
  if (!sel || sel.end <= sel.start) return null;
  const mark = WIDTH[kind];
  if (!mark) return null;

  const anns = parse(text);
  for (const a of anns) {
    if (sel.start < a.end && sel.end > a.start) return { blockedReason: 'markup' };
  }
  const g = guard(text, sel);
  if (g.error) return g.error === 'unsupported' ? { blockedReason: 'unsupported' } : null;

  const inner = text.slice(sel.start, sel.end);
  const wrapped = inner.startsWith(mark) && inner.endsWith(mark) && inner.length > mark.length * 2;
  const surrounded = text.slice(sel.start - mark.length, sel.start) === mark
    && text.slice(sel.end, sel.end + mark.length) === mark;

  let from = sel.start;
  let to = sel.end;
  let old;
  let next;

  if (wrapped) {
    old = inner;
    next = inner.slice(mark.length, -mark.length);
  } else if (surrounded) {
    from = sel.start - mark.length;
    to = sel.end + mark.length;
    old = text.slice(from, to);
    next = inner;
  } else {
    old = inner;
    next = mark + inner + mark;
  }

  const md = `{~~${old}~>${next}~~}`;
  return { text: splice(text, from, to, md), caret: { start: from + md.length, end: from + md.length }, coalesce: null };
}
