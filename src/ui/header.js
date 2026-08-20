/** The header bar: filename, dirty marker, view switch. */

export function createHeader(refs, { onView }) {
  Array.from(refs.views.children).forEach((b) => {
    b.addEventListener('click', () => onView(b.dataset.view));
  });

  return function render(state, dirty) {
    refs.dirtyDot.classList.toggle('on', dirty);
    refs.fileName.textContent = state.loaded ? state.name || 'untitled.md' : 'no file';
    refs.undo.disabled = !state.undo.length;
    refs.redo.disabled = !state.redo.length;
    refs.save.disabled = !state.loaded;
    refs.copy.disabled = !state.loaded;
    document.title = (dirty ? '\u25cf ' : '') + (state.name || 'redline');

    Array.from(refs.views.children).forEach((b) => {
      b.classList.toggle('on', b.dataset.view === state.view);
    });
  };
}
