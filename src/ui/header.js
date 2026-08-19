/** The header bar: filename, dirty marker, per-type counts, view switch. */
import { KINDS } from '../criticmarkup.js';

const COUNTED = [
  ['ins', 'ins'],
  ['del', 'del'],
  ['sub', 'sub'],
  ['com', 'hl'],
];

export function createHeader(refs, { onView }) {
  Array.from(refs.views.children).forEach((b) => {
    b.addEventListener('click', () => onView(b.dataset.view));
  });

  function renderCounts(anns) {
    const counts = { sub: 0, del: 0, ins: 0, com: 0 };
    for (const a of anns) counts[a.type === 'hl' ? 'com' : a.type]++;
    refs.counts.textContent = '';
    for (const [key, kindKey] of COUNTED) {
      const kind = KINDS[kindKey];
      const n = document.createElement('span');
      n.className = 'cnt';
      n.textContent = `${kind.sym} ${counts[key]}`;
      n.title = `${counts[key]} ${kind.label.toLowerCase()}${counts[key] === 1 ? '' : 's'}`;
      if (counts[key] > 0) {
        n.classList.add('on');
        n.style.setProperty('--c', kind.color);
        n.style.setProperty('--b', kind.bg);
      }
      refs.counts.append(n);
    }
  }

  return function render(state, dirty) {
    renderCounts(state.anns);
    refs.dirtyDot.classList.toggle('on', dirty);
    refs.fileName.textContent = state.loaded ? state.name || 'untitled.md' : 'no file';
    refs.undo.disabled = !state.undo.length;
    refs.redo.disabled = !state.redo.length;
    refs.save.disabled = !state.loaded;
    refs.copy.disabled = !state.loaded;
    document.title = (dirty ? '● ' : '') + (state.name || 'redline');

    Array.from(refs.views.children).forEach((b) => {
      b.classList.toggle('on', b.dataset.view === state.view);
    });

    const preview = state.view !== 'source';
    refs.note.classList.toggle('on', preview);
    if (state.view === 'accepted') refs.note.textContent = 'Preview — all edits accepted. Read-only.';
    if (state.view === 'rejected') refs.note.textContent = 'Preview — all edits rejected (original text). Read-only.';
  };
}
