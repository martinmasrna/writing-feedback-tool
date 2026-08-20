# TODO

Loose ends, in rough priority order. Read `CLAUDE.md` first — it carries the
architecture and the traps. This file is a working list, not a record; delete
what gets done.

## 1. A blank line the caret is standing on is not drawn

One blank line between two blocks is the separator and renders nothing, which is
right for spacing and wrong for the caret: the offset has no DOM node, so the
caret is drawn at the end of the line above instead. Press Enter and the cursor
appears not to move, though the next character does land correctly — `app.js`
keeps the offset it holds rather than the one the screen gives back.

It is the last of the caret-drawing gaps, and about 13% of states reached by
random editing hit it. Two reproductions:

- `editor('# T\n\nBody.\n').caretBefore('Body').press('Enter', 2)` — the caret
  belongs at the start of the new blank line and is drawn one position earlier.
- Any insertion ending in a newline leaves the caret in the same place.

**The decision to make.** A blank line needs somewhere to stand without gaining
visible height, and whether Chrome will hold a caret in a zero-height block is
the whole question. `p.blank-line` (min-height 1.65em) demonstrably does hold
one, so the likely answer is to draw *every* blank line and give only the extras
their height — but that must be checked in a real browser, not jsdom, which
accepts anything.

## 2. In-app assertions in development

Check the invariants after every render — caret landed somewhere addressable, an
edit changed the DOM — and log loudly. Turns ordinary use into precise bug
reports. Most of the checks already exist as test helpers in `test/dom.js`.

## 3. Playwright

The complete answer to testing the browser: real key events, the only thing that
catches bugs like `⌘⇧8` reporting `e.key === '*'`. `test/input.test.js` now
covers the mapping, but not that a real key produces the event. Heavy and slow;
worth it once 1 and 2 stop finding things.

## Known gaps, unfixed

- **Structural commands are keyboard-only.** ⌘B, ⌘⇧8, ⌘⌥1–6 and the rest have
  nothing on screen advertising them, so they are undiscoverable. The floating
  toolbar offers only Replace / Delete / Comment.

- **Untested in a browser at all:** IME composition, Shift+Arrow selection (left
  to the browser deliberately), the reason prompt in the rendered view since the
  refactors, and save-in-place through the File System Access API, which needs a
  real click and so has never run end to end. `src/files.js` and `src/ui/*` have
  no tests for the same reason.

- **jsdom does no layout.** `getBoundingClientRect()` returns zeroes, so toolbar
  and dialog positioning stay untestable without a real browser.

- **`test/render-contract.test.js` is redundant.** It infers what the renderer
  would draw by mirroring its block walk; `test/render.test.js` runs the
  renderer. Its two annotation tests are the only unique thing left in it.

- **`redline` is a placeholder name.** See `CLAUDE.md`. Nothing depends on it.

## The thing that has worked best

Using the tool on a real document for ten minutes has found sharper bugs than
any automated pass. Second best, and cheaper: cross two of the test layers.
Feeding fuzz-produced documents into the render checks, and running the
structural commands inside editing sessions instead of alone, each turned up a
class of bug that neither layer found on its own.
