# TODO

Loose ends, in rough priority order. Read `CLAUDE.md` first — it carries the
architecture and the traps. This file is a working list, not a record; delete
what gets done.

## 1. In-app assertions in development

Check the invariants after every render — caret landed somewhere addressable, an
edit changed the DOM — and log loudly. Turns ordinary use into precise bug
reports. Most of the checks already exist as test helpers in `test/dom.js`.

## Known gaps, unfixed

- **The caret is drawn in the wrong place right after a structural edit
  creates a new empty block** — pressing Enter inside a list item to open a
  new bullet, most visibly. `Selection`/`Range` genuinely holds the correct
  position (the new empty bullet — confirmed by reading `window.getSelection()`
  directly, and typing lands there correctly), but Chrome paints the blinking
  caret at the end of the block just left instead. Not a timing race — forcing
  a reflow and deferring the `Range` to the next animation frame before
  drawing it were both tried and neither changed anything. The likely cause:
  `getClientRects()` returns nothing for a collapsed range in a genuinely
  empty text node (confirmed directly — zero rects, a zeroed
  `getBoundingClientRect()`) even though the block around it has completely
  normal layout, because there is no text run there for Chrome to measure or
  paint against. The one fix that would attack this at the root — giving
  every empty landing spot a real character (a zero-width space) instead of
  an empty text node — was not attempted: `offsets.js`'s whole address system
  assumes a landing spot is zero source characters mapped to one screen point,
  and every place that assumption holds (`step()`, `pointToSource()`,
  `sourceToPoint()`, `vertical()`'s own block-boundary fallback) would need
  re-checking against a landing spot that is one real character instead. Real
  work, not a quick patch, and risks the same class of caret corruption this
  whole file exists to prevent.

  Everything downstream is already correct despite the wrong paint: arrow
  keys and typing operate on the real `Selection`, not the pixel it's drawn
  at, so the result matches the model — it's just confusing to watch, since
  the *next* keystroke visibly jumps to wherever the model already was.

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
