# TODO

Loose ends, in rough priority order. Read `CLAUDE.md` first — it carries the
architecture and the traps. This file is a working list, not a record; delete
what gets done.

## 1. Reference-model tests

**The problem.** 195 tests and a 400-session fuzz prove things about the
*document*. None of them encodes the actual bar, which is "behaves like a text
editor." That judgement currently lives in a person's head, so every divergence
has been found by someone noticing.

**The idea.** Keep a trivial plain-text editor alongside the real one: a string
and a caret, textbook semantics, no markup. Feed both the same keystrokes.
Assert after every one:

```
ed.accepted === reference.text        // the edit did what a normal editor does
ed.rejected === ed.original           // and the original is still recoverable
```

Divergence stops being a judgement call and becomes a failing test.

**Where.** A `referenceEditor()` beside `editor()` in `test/harness.js`, driven
from the existing fuzz in `test/fuzz.test.js` — it already generates the
sessions, it just has nothing to compare against.

**What it would have caught without anyone thinking of the case:** asking a
bullet to become a numbered item silently removed the list; backspace at the
head of a heading left `#Heading`.

**The judgement call to make.** Plain typing, deletion and arrows have an
obvious reference. Structural commands — bullets, heading levels — do not, since
a plain-text editor has no concept of them. Either model them markdown-aware, or
scope the reference to text operations and leave structure to the explicit
tests in `test/structure.test.js`. Scoping it is probably right; decide before
writing.

## 2. Render tests under jsdom

**The problem.** Nothing tests the screen. Four of the bugs found by hand were
"correct source, nothing visible happened" — see the invariant of that name in
`CLAUDE.md`. `test/render-contract.test.js` infers what the renderer *would*
draw by mirroring its block walk, which is a stand-in, not the thing itself.

**The idea.** Add `jsdom` as a devDependency, run the real `buildRendered()` and
`createOffsetIndex()` headlessly, and assert on the DOM that comes out. The
strongest single check:

> the rendered text, minus everything marked `data-virtual`, equals the visible
> document from `toVisible()`

**What that one assertion would have caught:** the code-block island vanishing
when a selection swallowed it; blank lines rendering as nothing so Enter looked
dead; `{++` leaking onto the screen when an annotation spanned a line break.

Worth asserting too: every mapping the renderer emits points at a real source
offset; list items group into one `<ul>` rather than one list each; a marker
mid-change carries its `marker-ins` / `marker-del` class.

**Limit.** jsdom does no layout, so `getBoundingClientRect()` returns zeroes.
Toolbar and dialog positioning stay untestable this way.

## Deferred

- **Playwright.** The complete answer — a real headless browser with real key
  events, the only thing that catches bugs like `⌘⇧8` reporting `e.key === '*'`,
  which is invisible to jsdom and to synthetic events alike. Heavy and slow.
  Worth it only once 1 and 2 stop finding things.
- **In-app assertions in development.** Check the invariants after every render —
  caret landed somewhere addressable, an edit changed the DOM — and log loudly.
  Turns ordinary use into precise bug reports.

## Known gaps, unfixed

- **Structural commands are keyboard-only.** ⌘B, ⌘⇧8, ⌘⌥1–6 and the rest have
  nothing on screen advertising them, so they are undiscoverable. The floating
  toolbar offers only Replace / Delete / Comment.
- **Untested in a browser at all:** IME composition, Shift+Arrow selection (left
  to the browser deliberately), the reason prompt in the rendered view since the
  refactors, and save-in-place through the File System Access API, which needs a
  real click and so has never run end to end.
- **`redline` is a placeholder name.** See `CLAUDE.md`. Nothing depends on it.

## The thing that has worked best

Using the tool on a real document for ten minutes has found sharper bugs than
any automated pass, including three testing agents. If in doubt, start there.
