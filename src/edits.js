/**
 * The editing engine.
 *
 * Every keystroke in the document becomes a CriticMarkup annotation rather than
 * a raw text change. These functions are pure — they take the current markdown
 * and a caret, and return the next markdown and caret. Nothing here touches the
 * DOM, which is what makes the behaviour testable outside a browser.
 *
 * Every function returns one of:
 *   {text, caret, coalesce}  a change to apply
 *   {caret}                  move the caret only (stepping over finished markup)
 *   {blocked: annotation}    refused, because it would corrupt existing markup
 *   null                     nothing to do
 *
 * `coalesce` groups consecutive keystrokes of the same kind into one undo step.
 */

import {
  parse, regionAt, annStartingAt, annEndingAt, overlapping, plainRun,
  bodyStart, bodyEnd, newStart, newEnd, sanitize, markup, reasonMd, originalOf,
} from './criticmarkup.js';

const at = (p) => ({ start: p, end: p });
const splice = (text, a, b, ins) => text.slice(0, a) + ins + text.slice(b);

/* -------------------------------------------------------------------------- */
/* Striking text out, merging with an adjacent deletion so that holding        */
/* backspace grows one annotation instead of making a chain of them.           */
/* -------------------------------------------------------------------------- */

/** Strike [a,b) out, merging into a deletion that begins exactly at b. */
function strikeBefore(text, anns, a, b) {
  const body = text.slice(a, b);
  const d = annStartingAt(anns, b);
  if (d && d.type === 'del') {
    return { text: text.slice(0, a) + '{--' + body + text.slice(bodyStart(d)), caret: at(a) };
  }
  return { text: splice(text, a, b, `{--${body}--}`), caret: at(a) };
}

/** Strike [a,b) out, merging into a reasonless deletion that ends exactly at a. */
function strikeAfter(text, anns, a, b) {
  const body = text.slice(a, b);
  const d = annEndingAt(anns, a);
  if (d && d.type === 'del' && !d.ctok) {
    return { text: text.slice(0, a - 3) + body + '--}' + text.slice(b), caret: at(a + body.length) };
  }
  // Land after the struck text, so the next forward delete merges into it.
  return { text: splice(text, a, b, `{--${body}--}`), caret: at(a + body.length + 6) };
}

/* -------------------------------------------------------------------------- */
/* Insertion                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Type `str` at the caret, or over the selection.
 *
 * Typing inside text you just inserted extends it in place, so a burst of
 * keystrokes yields one `{++…++}` rather than one per character.
 */
export function insert(text, sel, str) {
  const clean = sanitize(str || '');
  if (!clean) return null;
  const stripped = clean !== str;
  const anns = parse(text);

  if (sel.end > sel.start) {
    const blocked = overlapping(anns, sel.start, sel.end);
    if (blocked) return { blocked };
    const old = text.slice(sel.start, sel.end);
    return {
      text: splice(text, sel.start, sel.end, `{~~${old}~>${clean}~~}`),
      caret: at(sel.start + 3 + old.length + 2 + clean.length),
      coalesce: 'type',
      stripped,
    };
  }

  let p = sel.start;
  const region = regionAt(anns, p);

  if (region.kind === 'insBody' || region.kind === 'subNew') {
    return { text: splice(text, p, p, clean), caret: at(p + clean.length), coalesce: 'type', stripped };
  }
  if (region.kind === 'atomic') {
    // The caret landed inside finished markup; nudge it to the nearest edge.
    const a = region.a;
    p = p - a.start <= a.end - p ? a.start : a.end;
  }

  const prev = annEndingAt(anns, p);
  if (prev && prev.type === 'ins' && !prev.ctok) {
    const end = bodyEnd(prev);
    return { text: splice(text, end, end, clean), caret: at(end + clean.length), coalesce: 'type', stripped };
  }

  return {
    text: splice(text, p, p, `{++${clean}++}`),
    caret: at(p + 3 + clean.length),
    coalesce: 'type',
    stripped,
  };
}

/* -------------------------------------------------------------------------- */
/* Deletion                                                                    */
/* -------------------------------------------------------------------------- */

/** Strike out a selected range. */
export function deleteRange(text, sel, dir = 'back') {
  if (sel.end <= sel.start) return null;
  const anns = parse(text);
  const blocked = overlapping(anns, sel.start, sel.end);
  if (blocked) return { blocked };
  const r = dir === 'fwd'
    ? strikeAfter(text, anns, sel.start, sel.end)
    : strikeBefore(text, anns, sel.start, sel.end);
  return { ...r, coalesce: null };
}

/** Backspace at a collapsed caret. */
export function deleteBackward(text, p) {
  if (p <= 0) return null;
  const anns = parse(text);
  const region = regionAt(anns, p);
  const a = region.a;

  // Erasing text you typed yourself is a plain delete, not a tracked one.
  if (region.kind === 'insBody' && p > bodyStart(a)) {
    return a.a.length <= 1
      ? { text: splice(text, a.start, a.end, ''), caret: at(a.start), coalesce: 'del' }
      : { text: splice(text, p - 1, p, ''), caret: at(p - 1), coalesce: 'del' };
  }
  if (region.kind === 'subNew' && p > newStart(a)) {
    // Emptying the replacement turns the substitution back into a deletion.
    return a.b.length <= 1
      ? { text: splice(text, a.start, a.end, `{--${a.a}--}` + (a.ctok ? `{>>${a.ctok.a}<<}` : '')), caret: at(a.start), coalesce: 'del' }
      : { text: splice(text, p - 1, p, ''), caret: at(p - 1), coalesce: 'del' };
  }

  const prev = annEndingAt(anns, p);
  if (prev) {
    if (prev.type === 'ins' && !prev.ctok) {
      if (prev.a.length <= 1) return { text: splice(text, prev.start, prev.end, ''), caret: at(prev.start), coalesce: 'del' };
      const end = bodyEnd(prev);
      return { text: splice(text, end - 1, end, ''), caret: at(end - 1), coalesce: 'del' };
    }
    if (prev.type === 'sub' && prev.b.length > 0 && !prev.ctok) {
      if (prev.b.length <= 1) return { text: splice(text, prev.start, prev.end, `{--${prev.a}--}`), caret: at(prev.start), coalesce: 'del' };
      const end = newEnd(prev);
      return { text: splice(text, end - 1, end, ''), caret: at(end - 1), coalesce: 'del' };
    }
    return { caret: at(prev.start) }; // step over finished markup
  }

  const before = regionAt(anns, p - 1);
  if (before.kind !== 'plain') return before.a ? { blocked: before.a } : null;

  return { ...strikeBefore(text, anns, p - 1, p), coalesce: 'del' };
}

/** Forward delete at a collapsed caret. */
export function deleteForward(text, p) {
  if (p >= text.length) return null;
  const anns = parse(text);
  const region = regionAt(anns, p);
  const a = region.a;

  if (region.kind === 'insBody' && p < bodyEnd(a)) {
    return a.a.length <= 1
      ? { text: splice(text, a.start, a.end, ''), caret: at(a.start), coalesce: 'delf' }
      : { text: splice(text, p, p + 1, ''), caret: at(p), coalesce: 'delf' };
  }
  if (region.kind === 'subNew' && p < newEnd(a)) {
    return a.b.length <= 1
      ? { text: splice(text, a.start, a.end, `{--${a.a}--}` + (a.ctok ? `{>>${a.ctok.a}<<}` : '')), caret: at(a.start), coalesce: 'delf' }
      : { text: splice(text, p, p + 1, ''), caret: at(p), coalesce: 'delf' };
  }

  const next = annStartingAt(anns, p);
  if (next) {
    if (next.type === 'ins') {
      if (next.a.length <= 1) return { text: splice(text, next.start, next.end, ''), caret: at(next.start), coalesce: 'delf' };
      const start = bodyStart(next);
      return { text: splice(text, start, start + 1, ''), caret: at(p), coalesce: 'delf' };
    }
    return { caret: at(next.end) }; // step over finished markup
  }

  const after = regionAt(anns, p + 1);
  if (after.kind === 'atomic') return { blocked: after.a };

  return { ...strikeAfter(text, anns, p, p + 1), coalesce: 'delf' };
}

/* --- Word and line granularity, clamped to the surrounding plain run ------- */

export function wordBoundaryBack(text, p) {
  const [lo] = plainRun(parse(text), p);
  let q = p;
  while (q > lo && /\s/.test(text.charAt(q - 1))) q--;
  while (q > lo && !/\s/.test(text.charAt(q - 1))) q--;
  return q;
}
export function wordBoundaryForward(text, p) {
  const [, hi] = plainRun(parse(text), p);
  const limit = Math.min(hi, text.length);
  let q = p;
  while (q < limit && /\s/.test(text.charAt(q))) q++;
  while (q < limit && !/\s/.test(text.charAt(q))) q++;
  return q;
}
export function lineBoundaryBack(text, p) {
  const [lo] = plainRun(parse(text), p);
  let q = p;
  while (q > lo && text.charAt(q - 1) !== '\n') q--;
  return q;
}

export function deleteWordBackward(text, p) {
  const q = wordBoundaryBack(text, p);
  return q < p ? deleteRange(text, { start: q, end: p }, 'back') : deleteBackward(text, p);
}
export function deleteWordForward(text, p) {
  const q = wordBoundaryForward(text, p);
  return q > p ? deleteRange(text, { start: p, end: q }, 'fwd') : deleteForward(text, p);
}
export function deleteLineBackward(text, p) {
  const q = lineBoundaryBack(text, p);
  return q < p ? deleteRange(text, { start: q, end: p }, 'back') : null;
}

/* -------------------------------------------------------------------------- */
/* Deliberate annotations, reasons, removal                                    */
/* -------------------------------------------------------------------------- */

/** Annotate a selection explicitly (the floating toolbar's dialogs). */
export function annotate(text, sel, kind, replacement, reason) {
  if (sel.end <= sel.start && kind !== 'ins') return null;
  const anns = parse(text);
  const blocked = overlapping(anns, sel.start, sel.end);
  if (blocked) return { blocked };
  const old = text.slice(sel.start, sel.end);
  const md = markup(kind, old, sanitize(replacement || ''), sanitize(reason || ''));
  return { text: splice(text, sel.start, sel.end, md), caret: at(sel.start + md.length), coalesce: null };
}

/**
 * Attach or rewrite an annotation's reason.
 * `keep` is a caret to preserve across the edit; it shifts if it sits after the
 * comment being written.
 */
export function setReason(text, annStart, reason, keep) {
  const a = parse(text).find((x) => x.start === annStart);
  if (!a) return null;
  const md = reasonMd(sanitize(reason || ''));
  const from = a.ctok ? a.ctok.start : a.tok.end;
  const to = a.ctok ? a.ctok.end : a.tok.end;
  if (text.slice(from, to) === md) return null;

  const delta = md.length - (to - from);
  let caret = keep;
  if (caret && caret.start >= to) caret = { start: caret.start + delta, end: caret.end + delta };
  else if (!caret) caret = at(from + md.length);
  return { text: splice(text, from, to, md), caret, coalesce: null };
}

/** Remove an annotation, restoring whatever the original text was. */
export function removeAnnotation(text, annStart) {
  const a = parse(text).find((x) => x.start === annStart);
  if (!a) return null;
  const keep = originalOf(a);
  return {
    text: splice(text, a.start, a.end, keep),
    caret: { start: a.start, end: a.start + keep.length },
    coalesce: null,
  };
}
