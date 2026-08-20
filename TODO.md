# TODO

Loose ends, in rough priority order. Read `CLAUDE.md` first — it carries the
architecture and the traps. This file is a working list, not a record; delete
what gets done.

## 1. A blank line the caret is standing on is not drawn

One blank line between two blocks is the separator and renders nothing, which is
right for spacing and wrong for the caret: the offset has no DOM node, so the
caret is drawn at the end of the line above instead. The next character still
lands correctly — `app.js` keeps the offset it holds rather than the one the
screen gives back — so this is where the cursor *appears*, not where the text
goes.

Every everyday keystroke is now right, including Enter at the end of a
paragraph, at the end of the document, and at the end of a list item. What is
left is about 1.6% of states reached by random editing, all of them a caret
sitting on a separator blank line.

**The decision to make.** The line needs somewhere to stand without gaining
visible height, and whether Chrome will hold a caret in a zero-height block is
the whole question — if it will not, the caret is invisible, which is worse than
being a line too high. `p.blank-line` (min-height 1.65em) demonstrably does hold
one, and an empty `<li>` with a landing spot in it does too, so the shape of the
answer is there. It has to be checked in a real browser; jsdom accepts anything.

Drawing the *first* blank of a run instead of the last was tried and is not it:
273 bad states against 287, and no principle to justify either choice.

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

- **Dragging text within the document does nothing.** The drop point is never
  read out of `beforeinput`'s `getTargetRanges()`, so the text is re-inserted
  where it was deleted from and the two cancel. It used to leave a copy behind,
  which was worse. Fixing it properly needs a real browser to check what Chrome
  reports there; paste works.

- **Structural commands are keyboard-only.** ⌘B, ⌘⇧8, ⌘⌥1–6 and the rest have
  nothing on screen advertising them, so they are undiscoverable. The floating
  toolbar offers only Replace / Delete / Comment.

- **Untested in a browser at all:** IME composition, Shift+Arrow selection (left
  to the browser deliberately), the reason prompt in the rendered view since the
  refactors, and save-in-place through the File System Access API, which needs a
  real click. `files.js` has tests for the decision it makes but not for the API
  itself; `ui/dialog.js` and `ui/toolbar.js` have none.

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
