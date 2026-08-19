/** The floating toolbar shown over a selection. */

const ACTIONS = [
  { kind: 'sub', label: 'Replace…' },
  { kind: 'del', label: 'Delete' },
  { kind: 'hl', label: 'Comment', key: '⌘⌥M' },
];

export function createToolbar(node, { onAction }) {
  function build() {
    node.textContent = '';
    for (const action of ACTIONS) {
      const b = document.createElement('button');
      const label = document.createElement('span');
      label.textContent = action.label;
      b.append(label);
      if (action.key) {
        const kbd = document.createElement('kbd');
        kbd.textContent = action.key;
        b.append(kbd);
      }
      // Keep the document selection alive while the button is pressed.
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => onAction(action.kind));
      node.append(b);
    }
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
