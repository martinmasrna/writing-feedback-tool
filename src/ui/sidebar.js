/**
 * The annotation list: every edit in document order, with its reason.
 * Reasons are editable in place — this is the escape hatch for anything the
 * inline prompt was skipped on.
 */

import { KINDS, hasReason } from '../criticmarkup.js';
import { autoGrow } from './autosize.js';

const truncate = (s, n) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

const MARKER = /^\s*([-*+]|\d{1,9}[.)]|#{1,6})\s+$/;

/** Structural changes read as markers, which is meaningless out of context. */
function structural(a) {
  const describe = (m) => {
    const t = m.trim();
    if (t.startsWith('#')) return `heading level ${t.length}`;
    if (/^\d/.test(t)) return 'numbered item';
    return 'bullet';
  };
  if ((a.type === 'ins' || a.type === 'del') && MARKER.test(a.a)) {
    return `${describe(a.a)} ${a.type === 'ins' ? 'added' : 'removed'}`;
  }
  if (a.type === 'sub' && MARKER.test(`${a.a} `) && MARKER.test(`${a.b} `)) {
    return `${describe(a.a)} → ${describe(a.b)}`;
  }
  return null;
}

/**
 * The sign that says what kind of edit this is, since nothing else does.
 *
 * The excerpt used to sit under a DELETE or INSERT header, which named in
 * words what the colour and the strike already said. A replacement needs no
 * sign at all — two colours either side of an arrow is what a replacement
 * looks like — and a comment is its own highlight.
 */
const sign = (kind) => {
  const n = el('span', `sign sign-${kind}`, KINDS[kind].sym);
  n.setAttribute('aria-hidden', 'true');
  return n;
};

function excerpt(a) {
  const n = el('div', 'ex');
  const asStructure = structural(a);
  if (asStructure) {
    n.classList.add('ex-structural', `ex-${a.type}`);
    if (a.type !== 'sub') n.append(sign(a.type));
    n.append(document.createTextNode(asStructure));
    return n;
  }
  if (a.type === 'sub') {
    n.append(el('del', null, truncate(a.a, 60)), el('span', 'arrow', '→'), el('ins', null, truncate(a.b, 60)));
  } else if (a.type === 'ins') {
    n.append(sign('ins'), el('ins', null, truncate(a.a, 120)));
  } else if (a.type === 'del') {
    n.append(sign('del'), el('del', null, truncate(a.a, 120)));
  } else {
    n.append(el('mark', 'hl', truncate(a.a, 120)));
  }
  return n;
}

export function createSidebar(refs, { onReveal, onRemove, onReason }) {
  /** Swap the reason line for a textarea, committing on Enter or blur. */
  function editInPlace(a, host) {
    const ta = el('textarea');
    ta.rows = 2;
    ta.value = hasReason(a) ? a.reason.trim() : '';
    ta.placeholder = 'Why this edit?';
    host.textContent = '';
    host.append(ta);
    autoGrow(ta);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      onReason(a, commit ? ta.value : null);
    };
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    ta.addEventListener('blur', () => finish(true));
  }

  return function render(state) {
    const { list, count } = refs;
    list.textContent = '';
    count.textContent = state.anns.length ? String(state.anns.length) : '';

    if (!state.loaded) {
      list.append(el('div', 'empty-side', 'Load a document to begin.'));
      return;
    }
    if (!state.anns.length) {
      list.append(el('div', 'empty-side',
        'No annotations yet. Click into the document and type, or select text and press ⌫ — every change is tracked here.'));
      return;
    }

    state.anns.forEach((a, i) => {
      const item = el('div', 'item');
      item.dataset.i = String(i);
      const main = el('div');

      // A comment with nothing under it has no text to show, so it says so.
      main.append(a.type === 'com' ? el('div', 'ex ex-note', 'unanchored note') : excerpt(a));

      const why = el('div', 'why');
      if (hasReason(a)) why.textContent = a.reason.trim();
      else if (a.type === 'com') why.textContent = a.a;
      else { why.textContent = 'no reason given — click to add'; why.className = 'why none'; }
      why.title = 'Click to edit the reason';
      why.addEventListener('click', (e) => {
        // The textarea lives inside this same click target. Once editing has
        // started, clicks in it must place the caret or extend a selection,
        // rather than replace the textarea and select everything again.
        e.stopPropagation();
        if (e.target !== why) return;
        editInPlace(a, why);
      });
      main.append(why);

      item.append(main);

      const remove = el('button', 'del-btn ghost', '×');
      remove.title = 'Remove this annotation and restore the original text';
      remove.setAttribute('aria-label', 'Remove annotation');
      remove.addEventListener('click', (e) => { e.stopPropagation(); onRemove(a); });
      item.append(remove);

      item.addEventListener('click', () => onReveal(i));
      list.append(item);
    });
  };
}
