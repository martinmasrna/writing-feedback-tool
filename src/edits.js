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
  parse, tokenize, regionAt, annStartingAt, annEndingAt, overlapping, plainRun,
  bodyStart, bodyEnd, newStart, newEnd, sanitize, wellFormed, markup, reasonMd, originalOf, transform,
} from './criticmarkup.js';

const at = (p) => ({ start: p, end: p });
const splice = (text, a, b, ins) => text.slice(0, a) + ins + text.slice(b);

/**
 * Line endings the document never uses.
 *
 * A document is normalised to `\n` when it is loaded, but text arriving later
 * is not: paste and drop carry whatever the source had, and a `\r` left in the
 * file ends up on the tail of every line, inside the content of a block rather
 * than separating one — invisible on screen and wrong in the file.
 */
const oneKindOfNewline = (s) => (s || '').replace(/\r\n?/g, '\n');

/**
 * One character back, and one character forward — counted in code points, not
 * in the units JavaScript stores them in.
 *
 * An emoji is two units. Deleting one of them leaves a lone surrogate in the
 * document: invalid UTF-16, which shows as a replacement character and, once
 * the file is written out, *is* one. The emoji does not come back.
 */
const isHigh = (c) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c) => c >= 0xdc00 && c <= 0xdfff;

function backOne(text, p) {
  return p >= 2 && isLow(text.charCodeAt(p - 1)) && isHigh(text.charCodeAt(p - 2)) ? p - 2 : p - 1;
}
function forwardOne(text, p) {
  return p + 1 < text.length && isHigh(text.charCodeAt(p)) && isLow(text.charCodeAt(p + 1)) ? p + 2 : p + 1;
}
/** Is this body a single character — as a reader counts them, not as JS does? */
const onePoint = (s) => [...s].length < 2;

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
  const arrived = oneKindOfNewline(str);
  const clean = sanitize(arrived);
  if (!clean) return null;
  // Only delimiter removal is worth telling the user about; line endings are
  // housekeeping.
  const stripped = clean !== arrived;
  const anns = parse(text);

  if (sel.end > sel.start) {
    const blocked = overlapping(anns, sel.start, sel.end);
    if (blocked) return { blocked };
    const old = text.slice(sel.start, sel.end);
    if (!wellFormed(markup('sub', old, clean, ''))) return { blocked: { kind: 'delimiter' } };
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
  if (!wellFormed(markup('del', text.slice(sel.start, sel.end), '', ''))) return { blocked: { kind: 'delimiter' } };
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
    return onePoint(a.a)
      ? { text: splice(text, a.start, a.end, ''), caret: at(a.start), coalesce: 'del' }
      : { text: splice(text, backOne(text, p), p, ''), caret: at(backOne(text, p)), coalesce: 'del' };
  }
  if (region.kind === 'subNew' && p > newStart(a)) {
    // Emptying the replacement turns the substitution back into a deletion.
    return onePoint(a.b)
      ? { text: splice(text, a.start, a.end, `{--${a.a}--}` + (a.ctok ? `{>>${a.ctok.a}<<}` : '')), caret: at(a.start), coalesce: 'del' }
      : { text: splice(text, backOne(text, p), p, ''), caret: at(backOne(text, p)), coalesce: 'del' };
  }

  const prev = annEndingAt(anns, p);
  if (prev) {
    if (prev.type === 'ins' && !prev.ctok) {
      if (onePoint(prev.a)) return { text: splice(text, prev.start, prev.end, ''), caret: at(prev.start), coalesce: 'del' };
      const end = bodyEnd(prev);
      const from = backOne(text, end);
      return { text: splice(text, from, end, ''), caret: at(from), coalesce: 'del' };
    }
    if (prev.type === 'sub' && prev.b.length > 0 && !prev.ctok) {
      if (onePoint(prev.b)) return { text: splice(text, prev.start, prev.end, `{--${prev.a}--}`), caret: at(prev.start), coalesce: 'del' };
      const end = newEnd(prev);
      const from = backOne(text, end);
      return { text: splice(text, from, end, ''), caret: at(from), coalesce: 'del' };
    }
    return { caret: at(prev.start) }; // step over finished markup
  }

  const from = backOne(text, p);
  const before = regionAt(anns, from);
  if (before.kind !== 'plain') return before.a ? { blocked: before.a } : null;

  return { ...strikeBefore(text, anns, from, p), coalesce: 'del' };
}

/** Forward delete at a collapsed caret. */
export function deleteForward(text, p) {
  if (p >= text.length) return null;
  const anns = parse(text);
  const region = regionAt(anns, p);
  const a = region.a;

  if (region.kind === 'insBody' && p < bodyEnd(a)) {
    return onePoint(a.a)
      ? { text: splice(text, a.start, a.end, ''), caret: at(a.start), coalesce: 'delf' }
      : { text: splice(text, p, forwardOne(text, p), ''), caret: at(p), coalesce: 'delf' };
  }
  if (region.kind === 'subNew' && p < newEnd(a)) {
    return onePoint(a.b)
      ? { text: splice(text, a.start, a.end, `{--${a.a}--}` + (a.ctok ? `{>>${a.ctok.a}<<}` : '')), caret: at(a.start), coalesce: 'delf' }
      : { text: splice(text, p, forwardOne(text, p), ''), caret: at(p), coalesce: 'delf' };
  }

  const next = annStartingAt(anns, p);
  if (next) {
    if (next.type === 'ins') {
      if (onePoint(next.a)) return { text: splice(text, next.start, next.end, ''), caret: at(next.start), coalesce: 'delf' };
      const start = bodyStart(next);
      return { text: splice(text, start, forwardOne(text, start), ''), caret: at(p), coalesce: 'delf' };
    }
    return { caret: at(next.end) }; // step over finished markup
  }

  const to = forwardOne(text, p);
  const after = regionAt(anns, to);
  if (after.kind === 'atomic') return { blocked: after.a };

  return { ...strikeAfter(text, anns, p, to), coalesce: 'delf' };
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
export function lineBoundaryForward(text, p) {
  const [, hi] = plainRun(parse(text), p);
  const limit = Math.min(hi, text.length);
  let q = p;
  while (q < limit && text.charAt(q) !== '\n') q++;
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
export function deleteLineForward(text, p) {
  const q = lineBoundaryForward(text, p);
  return q > p ? deleteRange(text, { start: p, end: q }, 'fwd') : null;
}

/* --- Whole block markers -------------------------------------------------- */

/** The half of an annotation the caret may type into, or null. */
function editableBody(a) {
  if (a.type === 'ins') return [bodyStart(a), bodyEnd(a)];
  if (a.type === 'sub') return [newStart(a), newEnd(a)];
  return null;
}

/**
 * Take out a whole block marker — the `# `, `- `, `> ` at the head of a block.
 *
 * Usually that is an ordinary tracked deletion. But a marker can sit inside a
 * change still in flight: pressing Enter in a list writes the next `- ` into
 * the insertion, and backspacing there has to remove the bullet, not one
 * character of it. Striking it out is impossible inside an annotation, so it is
 * spliced away instead — the same rule as erasing text you just typed.
 *
 * Emptying the change removes it: an insertion disappears, and a substitution
 * falls back to the deletion it started as.
 */
export function removeMarker(text, range) {
  const host = parse(text).find((a) => {
    const body = editableBody(a);
    return body && range.start >= body[0] && range.end <= body[1];
  });
  if (!host) return deleteRange(text, range, 'back');

  const [from, to] = editableBody(host);
  const body = text.slice(from, range.start) + text.slice(range.end, to);
  if (body !== '') return { text: splice(text, from, to, body), caret: at(range.start), coalesce: 'del' };

  const tail = host.ctok ? `{>>${host.ctok.a}<<}` : '';
  const md = host.type === 'sub' ? `{--${host.a}--}${tail}` : '';
  return { text: splice(text, host.start, host.end, md), caret: at(host.start), coalesce: 'del' };
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
  const md = markup(kind, old, sanitize(oneKindOfNewline(replacement)), sanitize(oneKindOfNewline(reason)));
  if (!wellFormed(md)) return { blocked: { kind: 'delimiter' } };
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
  const md = reasonMd(sanitize(oneKindOfNewline(reason)));
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

/* -------------------------------------------------------------------------- */
/* The one promise                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Would this change what the document reverts to? Then it is not an edit.
 *
 * Rejecting every annotation has to give back exactly the document that was
 * opened — that is the whole contract with whoever reads the file afterwards.
 * Every operation here preserves it by construction, so a result that does not
 * is a sign the markup has been broken rather than extended.
 *
 * That happens when the file already holds CriticMarkup delimiters that are not
 * part of an annotation. A stray `--}` inside text being struck out ends the
 * deletion early; a stray `{--` anywhere earlier swallows the closing delimiter
 * of the next annotation made after it. Either way the document stops saying
 * what it said.
 *
 * Far cheaper to check than to enumerate, so the funnel every result passes
 * through asks this and refuses rather than corrupt the file.
 */
export function preservesOriginal(before, after) {
  return transform(after, 'rejected') === transform(before, 'rejected');
}

/* -------------------------------------------------------------------------- */
/* Normalisation                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Cancel edits that undo each other.
 *
 * Deleting a word and typing it back should leave no trace, not
 * `{--word--}{++word++}`. Editing is exploratory — you delete half a sentence,
 * rewrite it, change your mind again — and only the net effect is a review
 * comment worth anyone's time.
 *
 * Annotations that already carry a reason are never touched: a reason is a
 * deliberate act, and silently dissolving the edit it explains would throw that
 * away. Everything still mid-flight is fair game.
 */
export function normalize(text, caret) {
  let out = text;
  let cursor = caret;

  /**
   * Carry the caret across a rewrite.
   *
   * Outside the rewritten span it just shifts. Inside, it has to be re-found
   * rather than shoved to one end: normalisation preserves the accepted text
   * exactly, so the caret's position *within that text* is the thing that
   * survives. Slamming it to the end of the span drops it somewhere with no
   * position on screen, and it lands in the next block.
   */
  const move = (from, to, before, after) => {
    if (!cursor) return cursor;
    const delta = after.length - (to - from);
    const map = (p) => {
      if (p <= from) return p;
      if (p >= to) return p + delta;
      return from + offsetForAccepted(after, acceptedForOffset(before, p - from));
    };
    return { start: map(cursor.start), end: map(cursor.end) };
  };

  for (let pass = 0; pass < 20; pass++) {
    const runs = cancellableRuns(parse(out));
    let acted = false;

    for (const run of runs) {
      const before = run.map(rejected).join('');
      const after = run.map(accepted).join('');
      const from = run[0].start;
      const to = run[run.length - 1].end;

      // The run as a whole changes nothing: it is churn, not an edit.
      if (before === after) {
        cursor = move(from, to, out.slice(from, to), before);
        out = out.slice(0, from) + before + out.slice(to);
        acted = true;
        break;
      }

      // Trim what only appeared to change; failing that, say the run once.
      const rebuilt = shaved(before, after)
        ?? (run.length > 1 && !run.some(structural) ? one(before, after) : null);
      if (rebuilt === null || rebuilt === out.slice(from, to)) continue;
      cursor = move(from, to, out.slice(from, to), rebuilt);
      out = out.slice(0, from) + rebuilt + out.slice(to);
      acted = true;
      break;
    }

    if (!acted) break;
  }

  return { text: out, caret: cursor };
}

/** What this annotation leaves behind if the change is rejected. */
const rejected = (a) => (a.type === 'ins' ? '' : a.a);
/** And if it is accepted. */
const accepted = (a) => (a.type === 'del' ? '' : a.type === 'sub' ? a.b : a.a);

/**
 * A run trimmed of the text it only appeared to change, or null when there is
 * nothing to trim. Retyping "alpha" as "alpha beta" is an insertion of
 * " beta", not a rewrite of the whole phrase.
 */
function shaved(before, after) {
  const [prefix, addedCore, removedCore, suffix] = shave(after, before);
  if (!prefix && !suffix) return null;
  if (!cancels(addedCore, removedCore)) return null;
  return prefix
    + (removedCore ? `{--${removedCore}--}` : '')
    + (addedCore ? `{++${addedCore}++}` : '')
    + suffix;
}

/**
 * A block marker mid-change, which is not prose and must stay its own edit.
 *
 * `structure.js` finds the marker a bullet or a heading is currently wearing by
 * looking for an annotation whose whole body is one. Fold that annotation into
 * the edit beside it and the marker stops being findable: the next ⌘⇧8 sees no
 * bullet to replace and writes a second one, so a line ends up `- 1. Plain`.
 * The structural fuzz found this 151 sessions out of 600.
 *
 * Anything *opening* with a marker counts, not only a body that is nothing but
 * one: typing straight after adding a bullet extends that insertion, so the
 * marker is already sharing an annotation with prose by the time this runs.
 * Merging further buries it — and where `structure.js` had been refusing to
 * touch a marker it could not find, it instead found no marker at all and
 * wrote a second one.
 *
 * This pattern has to agree with MARKER in `structure.js`; a test holds them
 * to each other.
 */
const MARKER_LEAD = /^(\s*)([-*+]|\d{1,9}[.)]|#{1,6})([ \t]+)/;
const structural = (a) => MARKER_LEAD.test(a.a) || (a.type === 'sub' && MARKER_LEAD.test(a.b));

/**
 * A run of touching edits, written as the one edit it is.
 *
 * Deleting a word and typing its replacement leaves a deletion beside an
 * insertion — the same document that selecting the word and typing over it
 * writes as a single substitution, split only because the keystrokes arrived
 * in separate bursts. On screen that was a row of adjacent marks with no way
 * to see it was one thought, and downstream it was several edits where the
 * writer made one.
 *
 * The run's own text is untouched by this: what it rejects to and what it
 * accepts to are both concatenated in order, so the document underneath and
 * the document above are both exactly what they were.
 *
 * Null when the joined bodies would not read back as what was written. Two
 * bodies that are each fine can meet as a delimiter — a deletion ending in `~`
 * against an insertion opening with `>` — and an annotation that parses as
 * something else is worse than two that parse as themselves.
 */
function one(before, after) {
  if (!before && !after) return '';
  const md = !before ? `{++${after}++}`
    : !after ? `{--${before}--}`
    : `{~~${before}~>${after}~~}`;
  return wellFormed(md) ? md : null;
}

/**
 * Maximal runs of touching annotations that may be reconsidered as a whole.
 *
 * Comparing neighbouring pairs is not enough. Retyping a word and then adding a
 * paragraph break leaves the insertion and the deletion it cancels separated by
 * a third annotation, so a pairwise check sees nothing to do and the document
 * shows four changes whose net effect is none at all.
 *
 * A run stops at the first character of ordinary text, at a highlight or a bare
 * comment — neither is an edit — and at anything already carrying a reason,
 * which someone wrote deliberately.
 */
function cancellableRuns(anns) {
  const editable = (a) => (a.type === 'ins' || a.type === 'del' || a.type === 'sub') && !a.ctok;
  const runs = [];
  let current = [];
  for (let i = 0; i < anns.length; i++) {
    const a = anns[i];
    if (!editable(a)) { if (current.length) runs.push(current); current = []; continue; }
    const prev = current[current.length - 1];
    if (prev && prev.end !== a.start) {
      runs.push(current);
      current = [];
    }
    current.push(a);
  }
  if (current.length) runs.push(current);
  return runs;
}

/** How many accepted characters precede source offset `p` in this fragment. */
function acceptedForOffset(md, p) {
  let acc = 0;
  for (const t of tokenize(md)) {
    if (p <= t.start) return acc;
    if (t.type === 'plain') {
      if (p < t.end) return acc + (p - t.start);
      acc += t.end - t.start;
    } else if (t.type === 'ins') {
      if (p < t.end) return acc + clamp(p - (t.start + 3), 0, t.a.length);
      acc += t.a.length;
    } else if (t.type === 'sub') {
      if (p < t.end) return acc + clamp(p - (t.start + 3 + t.a.length + 2), 0, t.b.length);
      acc += t.b.length;
    } else if (p < t.end) {
      return acc;                    // inside a deletion or a comment: contributes nothing
    }
  }
  return acc;
}

/** The inverse: where in this fragment does accepted character `k` sit. */
function offsetForAccepted(md, k) {
  let acc = 0;
  for (const t of tokenize(md)) {
    if (t.type === 'plain') {
      const len = t.end - t.start;
      if (acc + len >= k) return t.start + (k - acc);
      acc += len;
    } else if (t.type === 'ins') {
      if (acc + t.a.length >= k) return t.start + 3 + (k - acc);
      acc += t.a.length;
    } else if (t.type === 'sub') {
      if (acc + t.b.length >= k) return t.start + 3 + t.a.length + 2 + (k - acc);
      acc += t.b.length;
    }
  }
  return md.length;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

/**
 * Only collapse when one side genuinely contains the other — that is the
 * "I deleted this and typed it back" case worth erasing.
 *
 * Incidental overlap is not: "alpha" and "beta" happen to share a trailing "a",
 * and shaving it would turn a legible `alpha -> beta` into `alph -> bet` with a
 * stray "a" beside it. Equivalent to a machine, worse for the person reading
 * the review.
 */
function cancels(addedCore, removedCore) {
  return !addedCore || !removedCore;
}

/**
 * Strip the head and tail that `added` and `removed` share.
 * @returns {[string,string,string,string]} prefix, added core, removed core, suffix
 */
function shave(added, removed) {
  let head = 0;
  while (head < added.length && head < removed.length && added[head] === removed[head]) head++;
  let tail = 0;
  while (
    tail < added.length - head
    && tail < removed.length - head
    && added[added.length - 1 - tail] === removed[removed.length - 1 - tail]
  ) tail++;
  return [
    added.slice(0, head),
    added.slice(head, added.length - tail),
    removed.slice(head, removed.length - tail),
    added.slice(added.length - tail),
  ];
}

/* -------------------------------------------------------------------------- */
/* Caret movement                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Where the caret may sit: anywhere except inside finished markup.
 *
 * Struck text, highlights and comment chips are `contenteditable="false"`, so
 * the browser will not put the caret inside them — but it also will not step
 * *over* them. An arrow press next to one appears to do nothing at all, and the
 * next thing you type lands wherever the caret was stuck. So we move the caret
 * ourselves.
 */
function isCaretPosition(anns, p) {
  return regionAt(anns, p).kind !== 'atomic';
}

/**
 * The next place the caret can legally sit, `dir` characters away.
 *
 * Plain text steps one character at a time. A run of finished markup is
 * stepped over whole, since every position inside it is illegal — so one press
 * takes you from one side of a deletion to the other, rather than nowhere.
 */
export function stepCaret(text, offset, dir) {
  const anns = parse(text);
  let p = offset + dir;
  while (p > 0 && p < text.length && !isCaretPosition(anns, p)) p += dir;

  // Never land between the halves of a surrogate pair.
  const code = text.charCodeAt(p);
  if (p > 0 && p < text.length && code >= 0xdc00 && code <= 0xdfff) p += dir;

  return Math.max(0, Math.min(p, text.length));
}
