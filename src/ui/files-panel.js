/**
 * The file panel: the dev server's safelisted folders as a tree, one click to
 * open a document. It exists only where there is a server to ask — the built
 * single file has none, so there it stays hidden and the page is unchanged.
 * Which folders are open is remembered per browser; the current document is
 * marked by its path.
 */

const OPEN_KEY = 'redline.files.expanded';
const SHOWN_KEY = 'redline.files.shown';

/** Folders first, then names, each in dictionary order. */
export function sortEntries(entries) {
  return [...entries].sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
}

const remember = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } };
const recall = (key, fallback) => { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } };

function chevron() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.classList.add('chev');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'm9 18 6-6-6-6');
  svg.append(path);
  return svg;
}

export function createFilesPanel(refs, { onOpen }) {
  const expanded = new Set(recall(OPEN_KEY, []));
  const children = new Map();   // folder path → entries, fetched on first expand
  let roots = [];
  let available = false;
  let shown = recall(SHOWN_KEY, true);
  let current = null;

  async function fetchJson(url) {
    try {
      const res = await fetch(url);
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  function show(on) {
    shown = on;
    remember(SHOWN_KEY, on);
    refs.main.classList.toggle('files-off', !(available && shown));
  }

  async function init() {
    const got = await fetchJson('/roots');
    available = Array.isArray(got) && got.length > 0;
    roots = available ? got : [];
    refs.panel.hidden = !available;
    refs.toggle.hidden = !available;
    refs.toggleSep.hidden = !available;
    show(shown);
    // A folder remembered as open is fetched now, so the tree comes back whole.
    await Promise.all([...expanded].map(load));
    render();
  }

  async function load(path) {
    const got = await fetchJson(`/list?path=${encodeURIComponent(path)}`);
    children.set(path, got ? sortEntries(got) : []);
  }

  async function toggleFolder(path) {
    if (expanded.has(path)) expanded.delete(path);
    else { expanded.add(path); if (!children.has(path)) await load(path); }
    remember(OPEN_KEY, [...expanded]);
    render();
  }

  function row(entry, depth) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `f-row ${entry.dir ? 'f-dir' : 'f-file'}`;
    b.style.paddingLeft = `${10 + depth * 14}px`;
    b.title = entry.path;
    if (entry.dir && expanded.has(entry.path)) b.classList.add('open');
    if (!entry.dir && entry.path === current) b.classList.add('cur');
    b.append(chevron());
    const name = document.createElement('span');
    name.className = 'f-name';
    name.textContent = entry.name;
    b.append(name);
    b.addEventListener('click', () => (entry.dir ? toggleFolder(entry.path) : onOpen(entry.path)));
    return b;
  }

  function branch(entries, depth, into) {
    for (const entry of entries) {
      into.append(row(entry, depth));
      if (entry.dir && expanded.has(entry.path)) {
        const kids = children.get(entry.path) || [];
        if (!kids.length) {
          const none = document.createElement('div');
          none.className = 'f-empty';
          none.style.paddingLeft = `${32 + depth * 14}px`;
          none.textContent = 'nothing to open';
          into.append(none);
        } else branch(kids, depth + 1, into);
      }
    }
  }

  function render() {
    refs.tree.textContent = '';
    branch(roots, 0, refs.tree);
  }

  refs.toggle.addEventListener('click', () => show(true));
  refs.close.addEventListener('click', () => show(false));

  return {
    init,
    get available() { return available; },
    /** Mark the document now open, and open its folders so it can be seen. */
    setCurrent(path) {
      if (path === current) return;
      current = path;
      if (path) {
        const parts = path.split('/');
        const opened = [];
        for (let i = parts.length - 1; i > 1; i--) {
          const dir = parts.slice(0, i).join('/');
          if (roots.some((r) => dir === r.path || dir.startsWith(r.path + '/'))) {
            if (!expanded.has(dir)) { expanded.add(dir); opened.push(dir); }
          }
        }
        remember(OPEN_KEY, [...expanded]);
        Promise.all(opened.filter((d) => !children.has(d)).map(load)).then(render);
      }
      render();
    },
  };
}
