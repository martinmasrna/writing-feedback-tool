/**
 * The annotation list: every edit in document order, with its reason.
 * Reasons are editable in place — this is the escape hatch for anything the
 * inline prompt was skipped on.
 */

import { KINDS, hasReason } from '../criticmarkup.js';

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

function excerpt(a) {
  const n = el('div', 'ex');
  if (a.type === 'sub') {
    n.append(el('del', null, truncate(a.a, 60)), el('span', 'arrow', '→'), el('ins', null, truncate(a.b, 60)));
  } else if (a.type === 'ins') {
    n.append(el('ins', null, truncate(a.a, 120)));
  } else if (a.type === 'del') {
    n.append(el('del', null, truncate(a.a, 120)));
  } else {
    n.textContent = truncate(a.a, 120);
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
    ta.focus();
    ta.select();

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

      const kind = el('div', 'kind');
      kind.style.color = KINDS[a.type].color;
      kind.append(el('span', null, `${KINDS[a.type].sym} ${KINDS[a.type].label}`));
      if (a.type === 'com') kind.append(el('i', null, 'unanchored'));
      main.append(kind);

      if (a.type !== 'com') main.append(excerpt(a));

      const why = el('div', 'why');
      if (hasReason(a)) why.textContent = a.reason.trim();
      else if (a.type === 'com') why.textContent = a.a;
      else { why.textContent = 'no reason given — click to add'; why.className = 'why none'; }
      why.title = 'Click to edit the reason';
      why.addEventListener('click', (e) => { e.stopPropagation(); editInPlace(a, why); });
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
