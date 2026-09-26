/**
 * Which inline code spans and link targets name another document.
 *
 * Agents write file references as `~/Work/x/PROBLEM.md` or `VIDEOS.md`, far
 * more often than as markdown links, so both count. The answer is the path as
 * written, with any `#anchor` or `:line` dropped; the dev server's /resolve
 * decides where it actually lives.
 */

const DOC = /\.(md|markdown|mdown|txt)$/i;

export function docRef(text) {
  const ref = text.trim().replace(/#.*$/, '').replace(/:\d+(-\d+)?$/, '');
  if (!ref || /^[a-z][\w+.-]*:/i.test(ref)) return null;   // a URL, not a file
  return DOC.test(ref) ? ref : null;
}
