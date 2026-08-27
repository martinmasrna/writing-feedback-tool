/**
 * Grow a textarea to fit what's typed in it, up to the CSS max-height already
 * set on the element — past that it scrolls like any other box. `resize:none`
 * has to come with this: a manual drag handle would fight the next keystroke,
 * which puts the height right back to what the content needs.
 */
export function autoGrow(ta) {
  const fit = () => {
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  };
  ta.addEventListener('input', fit);
  fit();
  return fit;
}
