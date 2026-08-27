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

import { blockFor } from './blocks.js';
import { parse, regionAt, overlapping, openBody } from './criticmarkup.js';
import { toVisible, toSource, toVisibleOffset, toSourceRange } from './visible.js';

const splice = (text, a, b, ins) => text.slice(0, a) + ins + text.slice(b);

/** Keep a caret pointing at the same character across an insertion at `at`. */
function shift(caret, at, delta) {
  if (!caret) return caret;
  const move = (p) => (p >= at ? p + delta : p);
  return { start: move(caret.start), end: move(caret.end) };
}

/**
 * Carry a caret across a replacement of [from,to).
 *
 * Shifting alone leaves a caret that was *inside* the replaced span exactly
 * where it was — which after the span shrinks is somewhere in the middle of the
 * new markup, a place the caret may never be. Rewriting `{++1. ++}` as
 * `{++- ++}` did precisely that. Inside means the marker it was in is gone, so
 * it comes to rest where the content now begins.
 */
function carry(caret, from, to, mdLength) {
  if (!caret) return caret;
  const delta = mdLength - (to - from);
  const move = (p) => {
    if (p <= from) return p;
    if (p >= to) return p + delta;
    return from + mdLength;
  };
  return { start: move(caret.start), end: move(caret.end) };
}

/**
 * An annotation body that is nothing but a block marker, with whatever line
 * break precedes it kept separate.
 *
 * Pressing Enter in a list writes the next item as `{++\n- ++}`, so the lead is
 * part of the annotation but not part of the marker. Treating the whole body as
 * the marker and replacing it wholesale swallowed the line break: `2. ` and
 * `1. second` became the single line `2. - `.
 */
const MARKER = /^(\s*)([-*+]|\d{1,9}[.)]|#{1,6})([ \t]+)$/;

/**
 * The tracked change a block marker currently sits inside, if any, and the
 * line break in front of it that must survive being retyped.
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
    const m = MARKER.exec(a.a);
    if (m) return { a, lead: m[1] };
  }
  return null;
}

/** Drop a tracked marker change, leaving the text as if it never happened. */
function revert(text, caret, a, lead) {
  // A struck marker comes back as the original text it was. An added one goes
  // entirely — except for the line break that put it on its own line, which the
  // user typed and which therefore stays a tracked insertion. Leaving it as
  // plain text would quietly adopt it into the original document.
  const keep = a.type === 'del' ? a.a : (lead ? `{++${lead}++}` : '');
  return { text: splice(text, a.start, a.end, keep), caret: carry(caret, a.start, a.end, keep.length), coalesce: null };
}

/** Refuse to touch anything we do not fully understand. */
function guard(text, caret) {
  const block = blockFor(text, caret.start);
  if (!block) return { error: 'no block' };
  if (block.type === 'unsupported') return { error: 'unsupported' };
  return { block };
}

/* -------------------------------------------------------------------------- */
/* Block markers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A block's marker — the `- `, `1. `, `## ` or `> ` — or null for a paragraph.
 *
 * The range is worked out on screen and mapped back, because source offsets lie
 * whenever markup is in the way. With a heading's text struck, `contentStart`
 * maps past the opening `{--`, and slicing to it takes the delimiter along;
 * substituting over that produced `{~~# {--~>## ~~}Title--}`, which is not
 * CriticMarkup at all. Rejecting it left `{--` sitting in the prose.
 */
function markerOf(text, block) {
  const from = block.visible.markerStart;
  const to = block.visible.markerEnd ?? block.visible.contentStart;
  if (from === undefined || to === undefined || to <= from) return null;
  const { start, end } = toSourceRange(toVisible(text), from, to);
  return { start, end, text: text.slice(start, end) };
}

/**
 * Where a marker can go at the head of a block that has none, or null when
 * there is nowhere for it and the command must refuse.
 *
 * The line is found on screen, not in the source. Looking back through the raw
 * text for a newline finds the one *inside* an insertion whose body holds a
 * line break, and splicing a marker at that offset nests one annotation inside
 * another: `{++\n\n{++- ++}++}` does not parse, and rejecting it leaves a
 * stray `++}` in the prose.
 *
 * It is the caret's line, not the block's first — consecutive paragraph lines
 * are one block, and a bullet belongs where the caret is.
 *
 * The front of an annotation is a fine place for a marker, as long as the line
 * starts there too. Anywhere else inside one, we decline rather than guess.
 */
function markerInsertPoint(text, block, caret) {
  const visible = toVisible(text);
  let line = toVisibleOffset(visible, caret.start);
  while (line > block.visible.contentStart && visible.text.charAt(line - 1) !== '\n') line--;

  const at = toSource(visible, line);
  const region = regionAt(parse(text), at);
  if (region.kind === 'plain') return at;
  const span = visible.spans.find((sp) => sp.annStart === region.a.start);
  return span && span.start === line ? region.a.start : null;
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
  const rewrite = (from, to, md) => ({
    text: splice(text, from, to, md),
    caret: carry(caret, from, to, md.length),
    coalesce: null,
  });

  // A marker already mid-change is rewritten in place, never nested inside a
  // second annotation.
  if (mine) {
    const { a, lead } = mine;
    if (!next) return revert(text, caret, a, lead);
    const md = a.type === 'ins' ? `{++${lead}${next}++}` : `{~~${a.a}~>${lead}${next}~~}`;
    return rewrite(a.start, a.end, md);
  }

  if (!marker) {
    if (!next) return null;
    const at = markerInsertPoint(text, block, caret);
    if (at === null) return { blockedReason: 'markup' };
    const md = `{++${next}++}`;
    return { text: splice(text, at, at, md), caret: shift(caret, at, md.length), coalesce: null };
  }

  // A marker inside a change that is not *only* the marker cannot be rewritten
  // in place — the substitution would land inside the annotation and nest.
  if (overlapping(parse(text), marker.start, marker.end)) return { blockedReason: 'markup' };
  if (marker.text === next) return null;
  const md = next ? `{~~${marker.text}~>${next}~~}` : `{--${marker.text}--}`;
  return rewrite(marker.start, marker.end, md);
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

/**
 * Move the current list item by one two-space indentation level. The spaces
 * are tracked as their own edit so accepting the review nests the item while
 * rejecting it restores the original line exactly.
 */
function changeIndent(text, caret, delta) {
  const g = guard(text, caret);
  if (g.error) return g.error === 'unsupported' ? { blockedReason: 'unsupported' } : null;
  const { block } = g;
  if (block.type !== 'listItem') return null;

  const visible = toVisible(text);
  const currentIndent = block.indent;
  const nextIndent = Math.max(0, currentIndent + delta);
  if (nextIndent === currentIndent) return null;

  const markerText = visible.text.slice(block.visible.markerStart, block.visible.markerEnd);
  const anns = parse(text);
  const markerAt = toSource(visible, block.visible.markerStart);
  const markerChange = markerAnnotation(text, markerAt);
  const markerSpan = markerChange
    && visible.spans.find((span) => span.annStart === markerChange.a.start);

  // A newly added marker may own the whole visible prefix. Extend that
  // insertion in place instead of nesting a second annotation inside it. An
  // Enter-created bullet also owns the preceding line break: `{++\n- ++}`.
  // Preserve that break while extending the marker's indentation.
  const markerLead = markerChange && markerChange.lead;
  const lineLead = markerLead ? markerLead.replace(/[ \t]+$/, '') : '';
  const expectedBody = markerChange && `${lineLead}${' '.repeat(currentIndent)}${markerText}`;
  if (markerChange && markerChange.a.type === 'ins'
    && markerSpan && markerSpan.start <= block.visible.start
    && markerSpan.end === block.visible.markerEnd
    && markerChange.a.a === expectedBody) {
    const md = `{++${lineLead}${' '.repeat(nextIndent)}${markerText}++}`;
    return {
      text: splice(text, markerChange.a.tok.start, markerChange.a.tok.end, md),
      caret: carry(caret, markerChange.a.tok.start, markerChange.a.tok.end, md.length),
      coalesce: null,
    };
  }

  const from = block.visible.start;
  const to = block.visible.markerStart;
  const prefixSpan = visible.spans.find((span) => span.start === from
    && span.end <= to && span.kind === 'ins');
  const prefixAnnotation = prefixSpan
    && anns.find((a) => a.start === prefixSpan.annStart && a.type === 'ins');

  // Keep repeated Tab presses in the same insertion instead of nesting a new
  // annotation inside the old indentation.
  if (prefixAnnotation && prefixAnnotation.tok.end === prefixAnnotation.end
    && prefixAnnotation.a === ' '.repeat(prefixSpan.end - prefixSpan.start)) {
    const bodyLength = delta > 0
      ? prefixAnnotation.a.length + 2
      : Math.max(0, prefixAnnotation.a.length - 2);
    const spaces = ' '.repeat(bodyLength);
    const md = spaces ? `{++${spaces}++}` : '';
    return {
      text: splice(text, prefixAnnotation.tok.start, prefixAnnotation.tok.end, md),
      caret: carry(caret, prefixAnnotation.tok.start, prefixAnnotation.tok.end, md.length),
      coalesce: null,
    };
  }

  if (delta > 0) {
    const at = toSource(visible, from);
    const region = regionAt(anns, at);
    // The indentation point sits inside an insertion still being typed — the
    // marker and whatever follows it on the same line, once Enter has split a
    // fresh bullet in two. Widen that insertion in place, the same way typing
    // a character there already would, rather than nesting a second one.
    if (region.kind === 'insBody' || region.kind === 'subNew') {
      const spaces = '  ';
      return { text: splice(text, at, at, spaces), caret: shift(caret, at, spaces.length), coalesce: null };
    }
    if (region.kind !== 'plain') return { blockedReason: 'markup' };
    const md = '{++  ++}';
    return { text: splice(text, at, at, md), caret: shift(caret, at, md.length), coalesce: null };
  }

  const remove = Math.min(2, currentIndent);
  const range = toSourceRange(visible, from, from + remove);
  const old = text.slice(range.start, range.end);
  if (old !== ' '.repeat(remove)) return { blockedReason: 'markup' };

  // Same reasoning in reverse: removing indentation that is itself still just
  // typing, not yet finished, shrinks the insertion instead of tracking a
  // deletion against a change that isn't done being made.
  const open = openBody(anns, range.start, range.end);
  if (open) {
    if (range.start === open.from && range.end === open.to) {
      const tail = open.a.ctok ? `{>>${open.a.ctok.a}<<}` : '';
      const md = open.sub ? `{--${open.a.a}--}${tail}` : '';
      return {
        text: splice(text, open.a.start, open.a.end, md),
        caret: carry(caret, open.a.start, open.a.end, md.length),
        coalesce: null,
      };
    }
    return {
      text: splice(text, range.start, range.end, ''),
      caret: carry(caret, range.start, range.end, 0),
      coalesce: null,
    };
  }

  if (overlapping(anns, range.start, range.end)) return { blockedReason: 'markup' };
  const md = `{--${' '.repeat(remove)}--}`;
  return {
    text: splice(text, range.start, range.end, md),
    caret: carry(caret, range.start, range.end, md.length),
    coalesce: null,
  };
}

export const indentListItem = (text, caret) => changeIndent(text, caret, 2);
export const outdentListItem = (text, caret) => changeIndent(text, caret, -2);

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
