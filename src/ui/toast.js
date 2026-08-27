/** Transient status messages. */
export function createToast(node) {
  let timer = null;
  return function toast(message) {
    node.textContent = message;
    node.classList.add('on');
    clearTimeout(timer);
    // A fixed timer either cuts off a long error before it's read or leaves a
    // short "Copied." sitting there too long. Scaled to roughly reading pace,
    // floored so a short message still gets a moment and capped so a long one
    // doesn't linger indefinitely.
    const duration = Math.min(7000, Math.max(2400, message.length * 45));
    timer = setTimeout(() => node.classList.remove('on'), duration);
  };
}
