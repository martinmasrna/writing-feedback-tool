/**
 * Rendering the markdown source with its CriticMarkup styled in place.
 *
 * Two invariants make the rest of the editor possible:
 *
 *  1. Every source character is emitted exactly once, in order. Offset mapping
 *     is then a running sum, and what you see is provably what is on disk.
 *  2. Anything that must not be typed into is `contenteditable="false"`, so the
 *     browser keeps the caret out of finished markup for us. Only the body of an
 *     insertion and the replacement half of a substitution stay editable.
 */

import { hasReason } from '../criticmarkup.js';

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}
const atomic = (n) => { n.setAttribute('contenteditable', 'false'); return n; };
/** A delimiter: real source text, dimmed, never typeable. */
const delim = (t) => atomic(el('span', 'syn', t));
const commentChip = (text) => {
  const c = atomic(el('span', 'a-com'));
  c.append(delim('{>>'), document.createTextNode(text), delim('<<}'));
  return c;
};

function annotationEl(a, index) {
  const wrap = el('span', 'ann');
  wrap.dataset.i = String(index);
  wrap.dataset.start = String(a.start);

  if (a.type === 'ins') {
    const ins = el('span', 'a-ins');
    ins.append(delim('{++'), document.createTextNode(a.a), delim('++}'));
    wrap.append(ins);
  } else if (a.type === 'del') {
    const d = atomic(el('span', 'a-del'));
    d.append(delim('{--'), document.createTextNode(a.a), delim('--}'));
    wrap.append(d);
  } else if (a.type === 'sub') {
    const sub = el('span', 'a-sub');
    const old = atomic(el('span', 'a-del'));
    old.append(delim('{~~'), document.createTextNode(a.a));
    const next = el('span', 'a-ins');
    next.append(document.createTextNode(a.b), delim('~~}'));
    sub.append(old, delim('~>'), next);
    wrap.append(sub);
  } else if (a.type === 'hl') {
    const h = atomic(el('span', 'a-hl'));
    h.append(delim('{=='), document.createTextNode(a.a), delim('==}'));
    wrap.append(h);
  } else {
    wrap.append(commentChip(a.a));
  }

  if (a.ctok) wrap.append(commentChip(a.ctok.a));

  if (a.type !== 'com' && !hasReason(a)) {
    const marker = atomic(el('span', 'noreason', 'no reason'));
    marker.dataset.virtual = '1';          // chrome, not source text
    marker.dataset.ann = String(index);
    marker.title = 'Click to explain this edit';
    wrap.append(marker);
  }
  return wrap;
}

/** Build the source view: plain runs interleaved with styled annotations. */
export function buildDocument(text, anns) {
  const frag = document.createDocumentFragment();
  let pos = 0;
  anns.forEach((a, i) => {
    if (a.start > pos) frag.append(document.createTextNode(text.slice(pos, a.start)));
    frag.append(annotationEl(a, i));
    pos = a.end;
  });
  if (pos < text.length) frag.append(document.createTextNode(text.slice(pos)));
  return frag;
}
