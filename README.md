# redline

Review markdown documents by editing them. Every change you make is recorded in
the file itself as [CriticMarkup](http://criticmarkup.com/), with the reason
attached — so a downstream agent can read each annotation as a
`{location, edit, reason}` triple.

It behaves like an ordinary text editor. Click in and type, select and press ⌫,
select and type over. Nothing is edited destructively:

| You do | The file gets |
| --- | --- |
| type at the cursor | `{++your text++}` |
| ⌫ or ⌦ on original text | `{--struck text--}` |
| select, then type | `{~~old~>new~~}` |
| ⌘⌥M on a selection | `{==passage==}{>>comment<<}` |
| ⌫ on text *you* just typed | plain erase — your own draft isn't tracked |

A reason is a comment directly after an edit: `{~~old~>new~~}{>>why<<}`. When you
move the cursor away from an edit, redline asks for one. Esc skips and leaves a
visible `NO REASON` marker; you can fill it in later from the sidebar.

## Running it

The shipped artifact is a single self-contained file:

```
npm install
npm run build       # → dist/index.html
open dist/index.html
```

**Open `dist/index.html`, not the `index.html` at the repo root.** That one is
the development shell: it loads ES modules, which browsers refuse over
`file://`. It will tell you so if you open it.

No server, no network, no accounts. Double-clicking `dist/index.html` from disk
is the intended way to use it. Where the browser exposes the File System Access
API, **Open** hands back a handle so ⌘S writes straight back to the original
file; everywhere else it falls back to a download.

## Developing

```
npm run dev         # static server on :4173, loads src/ as ES modules
npm test            # node's test runner, no browser needed
npm run test:watch
```

`npm run dev` exists because browsers refuse to load ES modules over `file://`.
The dev page and the built page run identical code.

## How it is put together

The annotated markdown is the entire state. Annotations are re-derived from the
text on every change rather than stored beside it, so the file and the UI cannot
drift apart. There is no database and no export step.

```
src/
  criticmarkup.js   parsing, offsets, serialisation            ← pure, tested
  edits.js          what each keystroke does to the source     ← pure, tested
  state.js          document store, history, caret
  input.js          beforeinput interception, shortcuts
  files.js          open / save / copy / drag-and-drop
  dom/render.js     source view construction
  dom/offsets.js    DOM position ↔ source offset mapping
  ui/               header, sidebar, toolbar, dialog, toast
  app.js            wiring
tools/build.js      bundles and inlines everything into one HTML file
```

Two invariants hold the design up.

**Every source character is rendered exactly once, in order.** Delimiters are
dimmed rather than hidden, so mapping a DOM position to a source offset is a
running sum over text nodes, and what you see is provably what is on disk.

**The browser never mutates the document.** `#doc` is `contenteditable`, but
every `beforeinput` is cancelled and turned into an operation on the markdown
string, which is then re-rendered. Anything that must not be edited — delimiters,
struck text, comment chips — is `contenteditable="false"`, so the caret cannot
get inside markup and corrupt it.

That second invariant is why `edits.js` is pure: the whole editing model is
`(text, caret) → (text, caret)`, which is testable without a DOM. The merge
rules live there — holding ⌫ grows one deletion rather than making a chain of
them, a burst of typing produces one insertion, emptying a substitution's
replacement collapses it back to a deletion.

## Scope

Annotations are only ever *created* here. Accepting or rejecting them is a
different tool's job — though **Accepted** and **Rejected** in the header preview
what the document would look like either way.

There is no rendered-markdown editing view. Selection has to map one-to-one onto
source offsets, and mapping a rendered view back to source is explicitly out of
scope.

## Known limits

- Desktop browsers only; developed against Chrome on macOS.
- Annotations cannot nest or overlap. Selecting across an existing annotation's
  boundary is refused with a message.
- IME composition is handled by discarding the browser's DOM edit and reapplying
  the composed string. It works, but has not been exercised heavily.
