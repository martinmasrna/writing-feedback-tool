/**
 * The row of controls over the document: view switch, undo, redo, help, open,
 * copy, save, and the annotation panel's toggle. It sits in the document pane
 * rather than in a bar of its own, so the only fixed thing on screen is the
 * document.
 *
 * The file name lives in the tab title now, unsaved work as a dot on Save.
 */

import { hasReason } from '../criticmarkup.js';

export function createControls(refs, { onView, onToggleSide }) {
  Array.from(refs.views.children).forEach((b) => {
    b.addEventListener('click', () => onView(b.dataset.view));
  });
  refs.side.addEventListener('click', () => onToggleSide());
  refs.sideClose.addEventListener('click', () => onToggleSide());

  return function render(state, dirty) {
    refs.undo.disabled = !state.undo.length;
    refs.redo.disabled = !state.redo.length;
    refs.save.disabled = !state.loaded;
    refs.copy.disabled = !state.loaded;
    refs.save.classList.toggle('dirty', dirty);
    document.title = (dirty ? '\u25cf ' : '') + (state.name || 'redline');

    // Folded away, the panel leaves behind the one number worth keeping:
    // how many edits are still owed a reason. Nothing to say when it is open,
    // because the list itself says it.
    const owed = state.anns.filter((a) => a.type !== 'com' && !hasReason(a)).length;
    refs.side.classList.toggle('on', state.sideOpen);
    if (state.sideOpen || !owed) refs.side.removeAttribute('data-count');
    else refs.side.dataset.count = String(owed);

    Array.from(refs.views.children).forEach((b) => {
      b.classList.toggle('on', b.dataset.view === state.view);
    });
  };
}
