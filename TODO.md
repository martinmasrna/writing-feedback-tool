# TODO

Loose ends, in rough priority order. Read `CLAUDE.md` first — it carries the
architecture and the traps. This file is a working list, not a record; delete
what gets done.

## 1. In-app assertions in development

Check the invariants after every render — caret landed somewhere addressable, an
edit changed the DOM — and log loudly. Turns ordinary use into precise bug
reports. Most of the checks already exist as test helpers in `test/dom.js`.

## Known gaps, unfixed

- **`offsets.vertical()` has no automated coverage at all.** It drives Up/Down
  by hand using `caretRangeFromPoint`, because Chrome's own key handling is
  unreliable around an empty block — verified on a page with none of this
  app's code running: the same keystroke lands correctly, skips the block, or
  drops the caret out of the editable region entirely, depending on the try.
  `document.caretRangeFromPoint` and real layout don't exist in jsdom, so
  `npm test` cannot exercise any of it — every case (into and out of an empty
  bullet, across a wrapped paragraph, skipping the invisible blank-line
  separator) was checked by hand in a real browser, not by a test. A
  regression here would not be caught by `npm test`.

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

- Renderer: a wrapped list item's continuation line (indented, no blank
  between) classifies as `paragraph` and renders outside the bullet
  (`src/blocks.js` classify() is per-line). Continuation lines should
  join their listItem. Filed 2026-09-03 from a niche-taxonomy session —
  Martin hit it redlining LAYER0.md; workaround was unwrapping bullets.
