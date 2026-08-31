/**
 * CriticMarkup parsing and serialisation.
 *
 * This module is pure: it knows about strings and offsets, nothing about the DOM.
 * The annotated markdown is the application's entire state, so everything else is
 * derived from what these functions return.
 *
 *   {++text++}            insertion
 *   {--text--}            deletion
 *   {~~old~>new~~}        substitution
 *   {==text==}            highlight
 *   {>>comment<<}         comment
 *
 * A comment directly following an edit is that edit's reason.
 */

/** All five constructs. Rebuilt per call so `lastIndex` is never shared. */
function pattern() {
  return /\{\+\+([\s\S]*?)\+\+\}|\{--([\s\S]*?)--\}|\{~~([\s\S]*?)~>([\s\S]*?)~~\}|\{==([\s\S]*?)==\}|\{>>([\s\S]*?)<<\}/g;
}

/** Every opening and closing delimiter is exactly this wide. */
export const DELIM = 3;

/**
 * Split text into a flat stream of plain runs and CriticMarkup tokens.
 * @returns {Array<{type:string,start:number,end:number,a?:string,b?:string}>}
 */
export function tokenize(text) {
  const re = pattern();
  const toks = [];
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) toks.push({ type: 'plain', start: last, end: m.index });
    const t = { start: m.index, end: m.index + m[0].length };
    if (m[1] !== undefined) { t.type = 'ins'; t.a = m[1]; }
    else if (m[2] !== undefined) { t.type = 'del'; t.a = m[2]; }
    else if (m[3] !== undefined) { t.type = 'sub'; t.a = m[3]; t.b = m[4]; }
    else if (m[5] !== undefined) { t.type = 'hl'; t.a = m[5]; }
    else { t.type = 'com'; t.a = m[6]; }
    toks.push(t);
    last = t.end;
  }
  if (last < text.length) toks.push({ type: 'plain', start: last, end: text.length });
  return toks;
}

/**
 * Fold the token stream into annotations, each absorbing a directly-following
 * comment as its reason. A comment with no edit before it stands alone.
 *
 * `start`/`end` span the edit *and* its reason; `tok` is the edit alone.
 */
export function collect(toks) {
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type === 'plain') continue;
    if (t.type === 'com') {
      out.push({ type: 'com', start: t.start, end: t.end, a: t.a, b: '', reason: t.a, tok: t, ctok: null });
      continue;
    }
    const next = toks[i + 1];
    let reason = null, ctok = null, end = t.end;
    if (next && next.type === 'com') { reason = next.a; ctok = next; end = next.end; i++; }
    out.push({ type: t.type, start: t.start, end, a: t.a, b: t.b || '', reason, tok: t, ctok });
  }
  return out;
}

/** Annotations in document order. */
export function parse(text) {
  return collect(tokenize(text));
}

export function hasReason(a) {
  return a.reason !== null && a.reason.trim() !== '';
}

/* --- Offsets of the editable/atomic regions inside one annotation ---------- */

export const bodyStart = (a) => a.tok.start + DELIM;
export const bodyEnd = (a) => a.tok.end - DELIM;
/** Substitutions only: the replacement half, after `old~>`. */
export const newStart = (a) => a.tok.start + DELIM + a.a.length + 2;
export const newEnd = (a) => a.tok.end - DELIM;

/* --- Lookups -------------------------------------------------------------- */

export function annStartingAt(anns, p) {
  return anns.find((a) => a.start === p) || null;
}
export function annEndingAt(anns, p) {
  return anns.find((a) => a.end === p) || null;
}

/**
 * What sits at this offset? `insBody` and `subNew` are the only regions the
 * caret may type into; `atomic` is finished markup that must not be edited.
 */
export function regionAt(anns, p) {
  for (const a of anns) {
    if (p < a.start || p > a.end) continue;
    if (a.type === 'ins' && p >= bodyStart(a) && p <= bodyEnd(a)) return { kind: 'insBody', a };
    if (a.type === 'sub' && p >= newStart(a) && p <= newEnd(a)) return { kind: 'subNew', a };
    if (p > a.start && p < a.end) return { kind: 'atomic', a };
  }
  return { kind: 'plain', a: null };
}

/** The annotation a range would collide with, if any. Touching a boundary is fine. */
export function overlapping(anns, start, end) {
  return anns.find((a) => start < a.end && end > a.start) || null;
}

/**
 * The annotation whose editable body fully contains `[start,end)`, if any.
 *
 * Text still inside it is nothing but typing that has not settled — the same
 * body `regionAt` already lets the caret stand in, just asked of a range
 * instead of a point. An edit that never leaves it is reshaping a draft, not
 * making a new change on top of one already made: `deleteBackward` shrinks a
 * single character this way today, and a range that never crosses the body's
 * edges deserves the identical answer, not a refusal that treats an
 * insertion still being typed as if it were finished, unrelated markup.
 */
export function openBody(anns, start, end) {
  const s = regionAt(anns, start);
  if (s.kind !== 'insBody' && s.kind !== 'subNew') return null;
  const e = regionAt(anns, end);
  if (e.a !== s.a) return null;
  const sub = s.kind === 'subNew';
  const [from, to] = sub ? [newStart(s.a), newEnd(s.a)] : [bodyStart(s.a), bodyEnd(s.a)];
  return { a: s.a, sub, from, to };
}

/** The widest annotation-free span containing `p`. */
export function plainRun(anns, p) {
  let lo = 0, hi = Infinity;
  for (const a of anns) {
    if (a.end <= p && a.end > lo) lo = a.end;
    if (a.start >= p && a.start < hi) hi = a.start;
  }
  return [lo, hi];
}

/* --- Writing -------------------------------------------------------------- */

/** Strip delimiters out of user-supplied text so it cannot corrupt the markup. */
export function sanitize(s) {
  return s.replace(/\{\+\+|\+\+\}|\{--|--\}|\{~~|~~\}|~>|\{==|==\}|\{>>|<<\}/g, '');
}

/** A reason comment, or nothing at all when there is no reason to record. */
export function reasonMd(reason) {
  const r = (reason || '').trim();
  return r ? `{>>${r}<<}` : '';
}

/**
 * Does this markup read back as the annotation it was written to be?
 *
 * A body runs to the first closing delimiter, so wrapping text that already
 * contains one ends the annotation early and leaves the rest as prose — at
 * worst an empty annotation, a stray delimiter and an orphaned comment. Typed
 * text is sanitised, but the document's own text never can be: it has to come
 * back character for character when the change is rejected.
 *
 * Asked of the markup rather than of the text, so it holds for every kind
 * without a table of what closes what. Nothing but annotations may be left.
 */
export function wellFormed(md) {
  return tokenize(md).every((t) => t.type !== 'plain');
}

/** Render an annotation of `kind` over `old`/`text`, with its reason attached. */
export function markup(kind, old, text, reason) {
  const tail = reasonMd(reason);
  if (kind === 'sub') return `{~~${old}~>${text}~~}` + tail;
  if (kind === 'del') return `{--${old}--}` + tail;
  if (kind === 'hl') return `{==${old}==}` + tail;
  if (kind === 'ins') return `{++${text}++}` + tail;
  throw new Error(`unknown annotation kind: ${kind}`);
}

/** The text with every edit applied ('accepted') or reverted ('rejected'). */
export function transform(text, mode) {
  let out = '';
  for (const t of tokenize(text)) {
    if (t.type === 'plain') out += text.slice(t.start, t.end);
    else if (t.type === 'ins') out += mode === 'accepted' ? t.a : '';
    else if (t.type === 'del') out += mode === 'accepted' ? '' : t.a;
    else if (t.type === 'sub') out += mode === 'accepted' ? t.b : t.a;
    else if (t.type === 'hl') out += t.a;
  }
  return out;
}

/** What the original text was, so removing an annotation can restore it. */
export function originalOf(a) {
  if (a.type === 'del' || a.type === 'hl' || a.type === 'sub') return a.a;
  return '';
}

export const KINDS = {
  ins: { label: 'Insert', sym: '+', color: 'var(--ins)', bg: 'var(--ins-bg)' },
  del: { label: 'Delete', sym: '−', color: 'var(--del)', bg: 'var(--del-bg)' },
  sub: { label: 'Replace', sym: '⇄', color: 'var(--ink)', bg: 'rgba(23,24,26,.06)' },
  hl: { label: 'Comment', sym: '▣', color: 'var(--com)', bg: 'var(--com-bg)' },
  com: { label: 'Comment', sym: '▣', color: 'var(--com)', bg: 'var(--com-bg)' },
};
