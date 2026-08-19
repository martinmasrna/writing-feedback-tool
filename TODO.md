# TODO

Loose ends, in rough priority order. Read `CLAUDE.md` first — it carries the
architecture and the traps. This file is a working list, not a record; delete
what gets done.

## 1. Playwright

The complete answer to testing the browser: a real headless browser with real
key events, the only thing that catches bugs like `⌘⇧8` reporting
`e.key === '*'`, which is invisible to jsdom and to synthetic events alike.
Heavy and slow. Worth it once the reference model and the render tests stop
finding things.

## 2. In-app assertions in development

Check the invariants after every render — caret landed somewhere addressable,
an edit changed the DOM — and log loudly. Turns ordinary use into precise bug
reports.

## Known gaps, unfixed

- **A blank line the caret is standing on is not drawn.** One blank line
  between two blocks is the separator and renders nothing, which is right for
  spacing and wrong for the caret: the offset has no DOM position, so reading
  the selection back moves it somewhere else. Two reproductions, both left out
  of the caret round-trip cases in `test/render.test.js`:

  - `editor('# T\n\nBody.\n').caretBefore('Body').press('Enter', 2)` leaves the
    caret at source 10, which reads back as 9 — the next keystroke lands
    between the two blank lines instead of after them.
  - `editor('- one\n- two\n').select('two').press('Enter').press('Backspace')`
    leaves it at 17, which reads back as 21, the end of the document.

  The fix is a decision about the rendered view — when a blank line stops being
  a separator and becomes somewhere to stand — not a patch to `offsets.js`,
  whose fallback picks the nearest node by *source* distance, a measure that
  means nothing across markup.

- **A heading mid-demotion renders at the level it is leaving.** `parseBlocks`
  takes the level the change is moving toward, so the editing model calls
  `{~~## ~># ~~}Title` a level 1; `parseVisibleBlocks` has no such rule, so the
  renderer draws `h2` with `# ` shown as inserted text inside it. The screen and
  the model disagree about what the block is.

- **`test/render-contract.test.js` is now redundant.** It infers what the
  renderer would draw by mirroring its block walk; `test/render.test.js` runs
  the renderer. Its two annotation tests are the only unique thing left in it.

- **Structural commands are keyboard-only.** ⌘B, ⌘⇧8, ⌘⌥1–6 and the rest have
  nothing on screen advertising them, so they are undiscoverable. The floating
  toolbar offers only Replace / Delete / Comment.

- **Untested in a browser at all:** IME composition, Shift+Arrow selection (left
  to the browser deliberately), the reason prompt in the rendered view since the
  refactors, and save-in-place through the File System Access API, which needs a
  real click and so has never run end to end.

- **jsdom does no layout.** `getBoundingClientRect()` returns zeroes, so toolbar
  and dialog positioning stay untestable without a real browser.

- **`redline` is a placeholder name.** See `CLAUDE.md`. Nothing depends on it.

## The thing that has worked best

Using the tool on a real document for ten minutes has found sharper bugs than
any automated pass, including three testing agents. If in doubt, start there.
