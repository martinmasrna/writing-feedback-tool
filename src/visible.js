/**
 * The visible document.
 *
 * Everything downstream — block structure, inline markdown, the rendered view —
 * works on the text a reader actually sees, not the source. This module is the
 * bridge: it resolves CriticMarkup once, for the whole document, into
 *
 *   - `text`   the visible characters, with delimiters gone and both halves of
 *              every change kept (a deletion is still on screen until accepted)
 *   - `map`    visible offset → source offset, so any edit maps back exactly
 *   - `spans`  which visible ranges are insertions, deletions, highlights
 *   - `comments` reasons, lifted out of the flow to be rendered as chips
 *
 * Doing this once, document-wide, is what keeps delimiters out of the markdown
 * parse. Parsing them together is why `{++\n- ++}` used to leak `{++` onto the
 * screen and why an edit inside *italic* broke the emphasis: a delimiter landed
 * in the middle of a construct the markdown parser was trying to match.
 */

import { tokenize } from './criticmarkup.js';

/**
 * The last document resolved, kept so the same one is not resolved five times
 * over for a single keystroke.
 *
 * `applyAction` alone asks for the visible document through `blockFor`,
 * `paragraphBreak` and `markerBefore`, and each pass walks every character in
 * the file. On a long document that was most of the cost of typing.
 *
 * Safe only because the result is treated as read-only everywhere. If anything
 * ever mutates `spans`, `map` or `comments`, this cache hands the damage to the
 * next caller.
 */
let lastSource = null;
let lastVisible = null;

/**
 * @returns {{text:string, map:number[], spans:Array, comments:Array, sourceLength:number}}
 */
export function toVisible(source) {
  if (source === lastSource) return lastVisible;
  const built = resolve(source);
  lastSource = source;
  lastVisible = built;
  return built;
}

function resolve(source) {
  const parts = [];
  // At most one visible character per source character, plus the end marker.
  // Preallocating and writing by index rather than pushing per character is
  // most of what this function costs on a long document.
  const map = new Array(source.length + 1);
  const spans = [];
  const comments = [];
  /** Visible characters emitted so far — the offset the next one will take. */
  let len = 0;

  /** Copy source [from,to) through to the visible text, recording provenance. */
  const copy = (from, to) => {
    if (to <= from) return;
    parts.push(source.slice(from, to));
    for (let i = from; i < to; i++) map[len++] = i;
  };

  let lastAnnotation = null;

  for (const t of tokenize(source)) {
    if (t.type === 'plain') {
      copy(t.start, t.end);
      lastAnnotation = null;
      continue;
    }

    if (t.type === 'com') {
      // A comment straight after an edit is that edit's reason; otherwise it
      // floats free. Either way it leaves the text flow.
      comments.push({
        at: len,
        text: t.a,
        annStart: lastAnnotation ? lastAnnotation.start : null,
        orphan: !lastAnnotation,
        start: t.start,
        end: t.end,
      });
      if (lastAnnotation) lastAnnotation.commented = true;
      lastAnnotation = null;
      continue;
    }

    const bodyStart = t.start + 3;
    if (t.type === 'sub') {
      const oldStart = bodyStart;
      const oldEnd = oldStart + t.a.length;
      const newStart = oldEnd + 2;
      const newEnd = t.end - 3;
      const delFrom = len;
      copy(oldStart, oldEnd);
      const insFrom = len;
      copy(newStart, newEnd);
      const span = { start: delFrom, end: insFrom, kind: 'del', annStart: t.start, pair: true };
      const span2 = { start: insFrom, end: len, kind: 'ins', annStart: t.start, pair: true };
      spans.push(span, span2);
      lastAnnotation = { start: t.start, end: len, commented: false };
      continue;
    }

    const kind = t.type === 'ins' ? 'ins' : t.type === 'del' ? 'del' : 'hl';
    const from = len;
    copy(bodyStart, t.end - 3);
    spans.push({ start: from, end: len, kind, annStart: t.start });
    lastAnnotation = { start: t.start, end: len, commented: false };
  }

  map[len] = source.length;   // so a caret at the very end still maps
  map.length = len + 1;
  return { text: parts.join(''), map, spans, comments, sourceLength: source.length };
}

/** Source offset for a visible offset. */
export function toSource(visible, offset) {
  const clamped = Math.max(0, Math.min(offset, visible.map.length - 1));
  return visible.map[clamped];
}

/**
 * The inverse: where a source offset appears on screen.
 *
 * Offsets swallowed by a delimiter have no visible position of their own, so
 * they resolve to the first one at or after them — which is where the caret
 * standing there is drawn.
 */
export function toVisibleOffset(visible, offset) {
  // The map is strictly ascending, and this is asked once per text node on
  // every render, so walking it is not good enough.
  const map = visible.map;
  let lo = 0;
  let hi = map.length - 1;
  if (offset > map[hi]) return hi;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (map[mid] >= offset) hi = mid; else lo = mid + 1;
  }
  return lo;
}

/**
 * Source range for a visible range.
 *
 * The end cannot go through `toSource`: the offset just past a visible run
 * often maps across a delimiter to somewhere much further on. One past the last
 * character of the run is the honest answer.
 */
export function toSourceRange(visible, from, to) {
  const start = toSource(visible, from);
  return { start, end: to > from ? visible.map[to - 1] + 1 : start };
}

/**
 * Split [from,to) of the visible text at every change boundary.
 * @returns {Array<{start:number,end:number,kind:string|null,annStart:number|null}>}
 */
export function sliceSpans(visible, from, to) {
  const edges = new Set([from, to]);
  for (const s of visible.spans) {
    if (s.end <= from || s.start >= to) continue;
    if (s.start > from) edges.add(s.start);
    if (s.end < to) edges.add(s.end);
  }
  const points = [...edges].sort((a, b) => a - b);
  const pieces = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;
    const hit = visible.spans.find((s) => s.start <= start && s.end >= end);
    pieces.push({ start, end, kind: hit ? hit.kind : null, annStart: hit ? hit.annStart : null });
  }
  return pieces;
}

/** Comments whose anchor falls inside [from,to). */
export function commentsIn(visible, from, to) {
  return visible.comments.filter((c) => c.at >= from && c.at <= to);
}
