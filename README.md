# redline

A tool for reviewing a written draft — usually something an AI wrote — by
editing it directly, the way you'd mark up a paper with a pen. Every change
you make stays in the file itself, with your reasoning attached, so it can be
read back later: by you, or by whoever (or whatever) acts on your feedback.

## What editing looks like

It behaves like an ordinary text editor — click in and type, select and
delete, select and type over — but nothing is changed silently:

| You do | The file records |
| --- | --- |
| Type something new | `{++your text++}` |
| Delete something | `{--struck text--}` (kept, not erased) |
| Select text and type over it | `{~~old~>new~~}` |
| Highlight a passage and comment (⌘⌥M) | `{==passage==}{>>your comment<<}` |

If every single edit were rejected, you'd get back exactly the file you
opened. Nothing is ever silently lost.

## Adding a reason

You don't have to explain an edit the moment you make it. Keep writing —
an edit with no explanation yet is just marked (a dashed outline). When
you're ready, hover it and click **Add a reason**, or use the sidebar, which
lists every edit still waiting on one.

## Two views

- **Rendered** — the normal view. Looks like a formatted document, with
  edits highlighted inline.
- **Source** — the raw markdown, for editing the few things the rendered
  view won't touch (tables, code blocks).

## Running it

```
npm install
npm run build
open dist/index.html
```

`dist/index.html` is a single self-contained file — no server, no account,
no internet connection. Open it in Chrome and start editing. Where your
browser allows it, ⌘S saves straight back to the file you opened instead of
downloading a copy.

(Open `dist/index.html`, not the `index.html` at the repo root — that one's
the dev version and needs `npm run dev` running to load.)

## For developers

```
npm run dev     # source version at localhost:4173
npm test        # test suite
```

The annotated markdown file *is* the state — nothing is stored anywhere
else. That also means editing two copies of the same file separately will
conflict, same as any other text file.

## Known limits

- Built and tested on Chrome on macOS; other browsers aren't guaranteed.
- Two edits can't overlap or nest in each other.
- You can't drag text to move it — cut and paste instead.
