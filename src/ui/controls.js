/**
 * The row of controls over the document: view switch, undo, redo, open, copy,
 * save. It sits in the document pane rather than in a bar of its own, so the
 * only fixed thing on screen is the document.
 *
 * The file name lives in the tab title now, unsaved work as a dot on Save.
 */

export function createControls(refs, { onView }) {
  Array.from(refs.views.children).forEach((b) => {
    b.addEventListener('click', () => onView(b.dataset.view));
  });

  return function render(state, dirty) {
    refs.undo.disabled = !state.undo.length;
    refs.redo.disabled = !state.redo.length;
    refs.save.disabled = !state.loaded;
    refs.copy.disabled = !state.loaded;
    refs.save.classList.toggle('dirty', dirty);
    document.title = (dirty ? '\u25cf ' : '') + (state.name || 'redline');

    Array.from(refs.views.children).forEach((b) => {
      b.classList.toggle('on', b.dataset.view === state.view);
    });
  };
}
