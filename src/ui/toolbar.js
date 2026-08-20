/**
 * The floating toolbar shown over a selection.
 *
 * One button. Deleting a selection is the Delete key and replacing it is
 * typing over it — nobody reaches for a menu to do either. Commenting has no
 * keystroke of its own beyond ⌘⌥M, which the shortcut list already names, so
 * this is the affordance that has to exist.
 */

export function createToolbar(node, { onAction }) {
  function build() {
    node.textContent = '';
    const b = document.createElement('button');
    b.textContent = 'Comment';
    // Keep the document selection alive while the button is pressed.
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => onAction('hl'));
    node.append(b);
  }

  return {
    show(rect) {
      build();
      node.classList.add('on');
      const w = node.offsetWidth;
      const h = node.offsetHeight;
      let x = rect.left + rect.width / 2 - w / 2;
      let y = rect.top - h - 8;
      if (y < 52) y = rect.bottom + 8;
      x = Math.max(10, Math.min(x, window.innerWidth - w - 10));
      node.style.left = `${Math.round(x)}px`;
      node.style.top = `${Math.round(y)}px`;
    },
    hide() { node.classList.remove('on'); },
  };
}
