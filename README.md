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
| ⌘⇧8, ⌘⌥1…6 and the rest | the marker itself, tracked — `{++- ++}`, `{~~## ~># ~~}` |
| ⌫ on text *you* just typed | plain erase — your own draft isn't tracked |

Rejecting every annotation gives back exactly the file you opened. That is the
one promise, and the editor enforces it: an edit that would break it is refused
rather than made.

## Reasons

A reason is a comment directly after an edit: `{~~old~>new~~}{>>why<<}`.

You are never interrupted for one. Reasons are a review-time act, not a
typing-time one — you press Enter for room, write, delete half of it, come back
ten minutes later. So an unexplained edit is *marked* instead: inline, in the
sidebar, and in the header counter. Click its sidebar entry to write the
reason, or press ⌘⌥R to walk through what is still outstanding.

Inline, nothing is drawn for a reason at all. The change is already on screen,
so it carries both states itself: its outline is dashed while a reason is
owed — the margin bar of a structural change goes dotted the same way — and
hovering it reads the reason once there is one. A comment with no edit under it
is the one thing with nothing to shade, so it keeps a mark of its own.

The text of a reason never sits in the line. A sentence of review commentary
set in the middle of the sentence under review is unreadable, and the sidebar
shows every reason in full anyway.

## Views

**Rendered** is the default and is a full editing surface: formatted prose, with
both halves of every change on screen — struck text still visible until someone
accepts it, a heading being demoted drawn at the level it is becoming.

**Source** shows the raw markdown with the delimiters dimmed. Every character is
on screen, so this is where you edit anything the rendered view will not touch:
code fences, tables and raw HTML render there as read-only islands.

**Accepted** and **Rejected** are read-only previews of the document either way.

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
npm test            # node's test runner; no browser, jsdom for the DOM layer
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
  criticmarkup.js       parsing, offsets, serialisation        ← pure
  visible.js            CriticMarkup resolved to what a reader sees
  blocks.js             headings, lists, quotes, islands
  inline.js             bold, italic, code, links
  edits.js              what each keystroke does to the source ← pure
  editor.js             one place every keystroke goes through ← pure
  structure.js          bullets, heading levels, emphasis      ← pure
  state.js              document store, history, caret
  input.js              beforeinput interception, shortcuts
  files.js              open / save / copy
  dom/render.js         source view construction
  dom/render-rendered.js  rendered view construction
  dom/offsets.js        DOM position ↔ source offset mapping
  ui/                   header, sidebar, toolbar, dialog, toast
  app.js                wiring
tools/build.js          bundles and inlines everything into one HTML file
```

Three invariants hold the design up.

**CriticMarkup is resolved before markdown is parsed.** `visible.js` turns the
source into the text a reader sees — delimiters gone, both halves of every
change kept — and the markdown parsing happens on *that*. Parsing the two
grammars together is what used to leak `{++` onto the screen and break emphasis
whenever an edit landed inside it.

**The browser never mutates the document.** `#doc` is `contenteditable`, but
every `beforeinput` is cancelled and turned into an operation on the markdown
string, which is then re-rendered. Anything that must not be edited — delimiters,
struck text, comment marks — is `contenteditable="false"`.

**Anything about where the caret is gets asked in visible coordinates.** Source
offsets lie whenever markup is in the way, and quietly: two offsets six
characters apart in the file can be the same place on screen, and a block whose
first character is inside an annotation starts past its own opening delimiter.

The second invariant is why `edits.js` is pure: the whole editing model is
`(text, caret) → (text, caret)`, testable without a DOM. The merge rules live
there — holding ⌫ grows one deletion rather than a chain, a burst of typing
produces one insertion, emptying a substitution's replacement collapses it back
to a deletion, and edits that undo each other leave nothing behind.

## Scope

Annotations are only ever *created* here. Accepting or rejecting them is a
different tool's job — though **Accepted** and **Rejected** in the header preview
what the document would look like either way.

Markdown is a closed set: headings, paragraphs, bold, italic, inline code,
links, bullet and numbered lists, blockquotes, rules. Code fences, tables and
raw HTML are shown but not parsed, and are edited in the Source view. Nothing
guesses at structure it does not fully understand.

## Known limits

- Desktop browsers only; developed against Chrome on macOS.
- Annotations cannot nest or overlap. Selecting across an existing annotation's
  boundary is refused with a message.
- IME composition is handled by discarding the browser's DOM edit and reapplying
  the composed string. It works, but has not been exercised heavily.
- Dragging text within the document does not move it; use cut and paste.
