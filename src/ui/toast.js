/** Transient status messages. */
export function createToast(node) {
  let timer = null;
  return function toast(message) {
    node.textContent = message;
    node.classList.add('on');
    clearTimeout(timer);
    timer = setTimeout(() => node.classList.remove('on'), 3600);
  };
}
