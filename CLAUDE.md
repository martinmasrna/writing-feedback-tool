# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## What this is

A markdown review tool. You open a document written by someone (usually an AI agent), edit it like a normal text editor, and every change is recorded in the file itself as CriticMarkup with a reason attached. Downstream, an agent reads each annotation as a `{location, edit, reason}` triple.

The name `redline` is a **placeholder** — it is the correct industry term, but it is also
taken by adjacent markdown-review projects. Nothing depends on it. Don't build identity
around it, and don't reopen the question unasked.

**The annotated `.md` file is the entire state.** No database, no export step. Annotations are re-derived from the text on every change rather than stored beside it, so the file and the UI cannot drift apart. If you find yourself caching parsed annotations anywhere but `state.js`, stop.

## Three invariants hold the design up

Break any one and the editor corrupts documents. Read these before touching `src/dom/`, `src/visible.js` or `src/input.js`.

**CriticMarkup is resolved before markdown is parsed.** `visible.js` turns the source into the text a reader sees — delimiters gone, both halves of every change kept — plus an offset map back to the source and a list of change ranges. Blocks and inline markdown are parsed on *that*, never on the raw source, and change styling is painted on afterwards by splitting text at range boundaries.

This is not a refactor for tidiness. Parsing the two grammars together is what made `{++\n- ++}` leak `{++` onto the screen, broke `*italic*` when an edit landed inside it, and broke `` `code` `` the same way. One delimiter in the middle of a construct the markdown parser is trying to match breaks the match. Resolve first, always.

**Every text node the renderer creates carries a source mapping.** The source view can map DOM to source with a running sum because it renders every character; the rendered view drops `**` and `#` from the screen, so it emits explicit mappings instead (`dom/offsets.js` takes either). Anything on screen *not* backed by source text — bullets, island labels, rules, the bar a structural change is drawn as — must carry `data-virtual` so the caret cannot address it.

**The browser never mutates the document.** `#doc` is `contenteditable`, but every `beforeinput` is cancelled and translated into an operation on the markdown string, which is then re-rendered from scratch. Anything that must not be edited — struck text, unsupported blocks, the source view's delimiters — is `contenteditable="false"` so the caret cannot get inside markup. Never let a browser-native edit through.

Every `inputType` the switch in `input.js` does not name is therefore a keystroke that silently does nothing. `deleteByCut` went unnamed for a while, so ⌘X put the selection on the clipboard and left it in the document.

**Anything about where the caret *is* must be asked in visible coordinates.** Source offsets lie whenever markup is in the way, and they lie quietly. A block's source range runs from its first drawn character to its last, so a block that opens inside an annotation begins past the opening delimiter and a caret in front of that delimiter falls outside every block. `toSource` on the end of a run answers with the first drawn character *after* it, which may be several delimiters away. Distance measured in source characters means nothing at all: the end of one line and the start of the next can be six characters apart in the source and adjacent on screen.

Every one of these was a real bug. `blockFor` resolves a caret's block on screen — reading it in the source sent structural commands to the last block in the document. `markerBefore` and `markerOf` map marker ranges through `toSourceRange`, because slicing to a mapped `contentStart` swallowed a `{--`. `markerInsertPoint` finds the caret's line on screen, because looking back through raw text for a newline finds one *inside* an insertion and nests markup there. `visible.js` exports `toVisibleOffset` and `toSourceRange` for exactly this. When you are about to compare two source offsets, stop and ask whether you mean the same place on screen.

## The rendering pipeline

```
source ──▶ visible document ──▶ blocks ──▶ inline ──▶ DOM
           (visible.js)         (blocks)   (inline)   (dom/render-rendered.js)
```

Each stage only ever sees the output of the one before it. `blocks.js` and `inline.js` know nothing about CriticMarkup — that is the point.

Structure is parsed here rather than by a markdown library for one decisive reason: **a block marker can itself be a tracked change.** `{++- ++}Some text` is a bullet that was added and must render as a bullet, tinted. A general parser sees no list there at all.

## What to read, and when

**Read nothing up front beyond this file**, except `TODO.md` if you are picking
up work rather than answering a question. Pull only what the task needs.

| task | context |
|---|---|
| the markup syntax, parsing, offsets | `src/criticmarkup.js` — pure, and the vocabulary everything else uses |
| anything about how the rendered view sees the document | `src/visible.js` — read this before `blocks.js` or `inline.js` |
| block structure, list markers, headings | `src/blocks.js` |
| bold, italic, code, links | `src/inline.js` |
| adding or removing a bullet, heading level, emphasis | `src/structure.js` |
| what a keystroke does | `src/edits.js` — pure; the merge rules live here |
| caret lands in the wrong place after an edit | `src/dom/offsets.js`, then the visible-coordinates invariant above |
| which block is the caret in | `blockFor()` in `src/blocks.js` — never compare source offsets by hand |
| a keystroke does nothing or the wrong thing | `src/input.js` — the `beforeinput` switch |
| undo granularity, dirty state, history | `src/state.js` |
| what the annotated file looks like on screen | `src/dom/render.js` |
| open, save, save-in-place, drag-and-drop | `src/files.js` |
| how it all connects | `src/app.js` — orchestration only, no rules |
| testing an editing rule | `test/harness.js` — `editor()` to drive it, `mirror()` to hold it against a plain text editor |
| testing what reaches the screen | `test/dom.js`, then `test/render.test.js` |

## Conventions

**Never interrupt editing to ask for a reason.** Reasons are a review-time act, not a typing-time one — people press Enter for room, write, delete half of it, come back ten minutes later. An earlier build prompted whenever the cursor left an edit; it re-armed itself on the next cursor move and became inescapable. Unexplained edits are *marked* — inline and in the sidebar — and explained when the writing is done, either from the sidebar entry or by walking them with ⌘⌥R.

**A change must be visible the instant it is made.** Several ways this went wrong, both of which read to the user as "the key did nothing": striking one newline out of a `\n\n` block separator left the screen identical, and an arrow key aimed at an offset the rendered view cannot address snapped straight back. Backspace at the top of a block now removes the whole separator and the blocks visibly join — `splitLines` ignores deleted line breaks, so they stop separating anything — and `offsets.step()` walks only positions that exist on screen. Pressing Enter for space was a third: the renderer skipped blank blocks entirely, so extra blank lines produced no DOM at all. One blank line between two blocks is the separator and stays invisible; every further one renders as an empty paragraph you can put the caret in.

If an edit or a keystroke produces no visible change, that is a bug even when the source is correct.

**Caret movement across markup is ours to drive, not the browser's.** Struck text and the source view's delimiters are `contenteditable="false"`, and Chrome will neither put the caret inside them *nor step over them* — an arrow press beside a deletion does nothing at all, and the next keystroke lands wherever the caret was stuck. `stepCaret()` in `edits.js` moves it: plain text one character at a time, a run of finished markup skipped whole in a single press. Any new unedittable region must be reachable past, or it becomes a wall — and must have somewhere to stand on the far side of it, which is what the landing spots in `render-rendered.js` are. Without one, deleting a word off the end of a paragraph and typing the replacement put it in the paragraph below.

**Up/Down is hand-driven too, but for a different reason than Left/Right, and by a different method.** Left/Right is a text question — which character is next — answerable from the string alone. Up/Down is a layout question — which line is below this pixel — and reimplementing that by counting `\n` characters in the visible text was tried and failed: a wrapped paragraph has no `\n` inside it, so the hand-rolled counter treated the whole thing as one line and jumped clean over it. Trusting Chrome's own ArrowUp/ArrowDown instead was also tried and also failed, for an unrelated reason: verified on a page with none of this app's code running at all, the identical keystroke against an empty block — an empty bullet, or the always-invisible single blank line between two paragraphs — lands correctly, skips the block, or drops the caret out of the editable region entirely, depending on the try. A real, present Chromium bug, not something this app's markup or CSS causes. `offsets.vertical()` avoids both failures by asking the browser's own layout directly: `caretRangeFromPoint` walks real line boxes, wrapped paragraphs included, the same hit-testing a click uses, without ever touching the unreliable native key handling. How far past the current line to probe is answered by walking outward a few pixels at a time rather than guessing a distance, because a collapsed range's own rect is font-metric tall — the glyph box, not the block's CSS line-height — so any fixed step is either too short to clear a paragraph's margin or wrong for a different block's spacing. And a candidate is not accepted merely for resolving to a different offset: a hit-test a few pixels into the line just left can resolve to a different column of that same line (an empty bullet's own text lands at the very start of the paragraph below it — different offset, same line) — so a candidate still inside the block just left is only accepted once its own rect genuinely clears that line, while a candidate that has reached a *different* block is accepted on sight, because an empty block's own rect is exactly as degenerate as the thing being walked past and cannot be trusted to confirm anything. `caretRangeFromPoint` does not exist in jsdom, so none of this has automated coverage — see `TODO.md`.

**An empty landing spot needs a glyph beside it, or Chrome paints the caret somewhere else entirely.** Not a timing issue — forcing a reflow and deferring the redraw to the next animation frame before setting the `Range` were both tried, and neither changed anything. The real cause: `getClientRects()` on a collapsed range measures text runs, and a genuinely empty text node has none, even though the block around it — the bullet a structural edit just opened, most visibly — is laid out completely normally. With nothing to measure, Chrome draws the caret at the end of whatever precedes it instead. `Selection`/`Range` hold the correct position throughout — confirmed directly, and typing lands there correctly — only the paint is wrong, but a caret glued to the wrong line reads as "nothing happened" to a person watching the screen, and every subsequent keystroke looks like it's operating on the wrong thing because it's operating on a position nobody can see. The mapped landing spot itself stays genuinely empty — giving it a real character would let a caret point at a source offset with no character behind it, corrupting the one thing this file's whole address system exists to keep true. Instead it gets an *unmapped* sibling, `.caret-anchor`, carrying one real zero-width space: `data-virtual` so no offset ever addresses it, `contenteditable="false"` so it can't be typed into directly, and `user-select:none` so a drag or a Shift+arrow selection can't pick it up — confirmed directly, `Selection.toString()` after a selection spanning one comes back clean. Chrome now has a glyph to paint the caret against; the document never gains a character it doesn't have.

**The caret we hold is better than the caret the screen gives back.** Rendering writes the caret into the DOM, which fires `selectionchange`, which reads it straight back. That round trip is lossy — the end of an insertion body and the position past its closing delimiter are the same place on screen, and a `**` or a block separator is not drawn at all — and it happens after every render, so the loss compounds into the next keystroke. `readBack()` in `dom/offsets.js` answers "would this offset come back as that one", and `app.js` keeps what it holds when the answer is yes. Trusting the reading instead changed the resulting document in 427 of 500 random editing sessions.

**Rejecting every annotation gives back exactly the file that was opened, and that is enforced, not merely tested.** Every operation preserves the underlying document by construction, so a result that does not has broken the markup rather than extended it. `store.apply()` asks `preservesOriginal()` and refuses if the answer is no; `test/harness.js` does the same, or tests would prove things the app will not do.

It is reachable. A file can arrive holding CriticMarkup delimiters that are not part of an annotation — prose that mentions them, a code sample, a document about this tool. A stray `--}` inside text being struck out ends the deletion early and strands the rest as prose; a stray `{--` anywhere earlier swallows the closing delimiter of the next annotation made after it, however far away. Typed text is sanitised, but the original never can be: it has to come back character for character.

Two checks, because there are two failures. `wellFormed()` asks whether the markup just written reads back as what was written — after wrapping, nothing but annotations may be left — and is asked wherever the document's own text gets wrapped. It catches the cases the funnel cannot see, because some of them leave the text intact: highlighting a run that opens with `==}` produced an empty highlight, a stray delimiter and an orphaned comment, and every character was still where it started.

**Every way into the document goes through `applyAction`, `structure.js` or `annotate()`.** Those three are where the guards live: an island must not be swallowed, an annotation must not nest inside another. Anything that reaches `edits.js` directly bypasses them, and that has now happened three times — the floating toolbar calling `edits.annotate`, IME composition calling `edits.insert`, and `input.js` not naming an `inputType` at all. If you are adding a fourth way to change the text, it goes through one of the three.

**Text arriving from outside is cleaned once, on the way in.** Paste, drop, IME composition and the dialog's own fields all reach `edits.insert` or `annotate`, and both sanitise delimiters out — user text can never forge markup — and normalise line endings, because a document is `\n`-separated and a `\r` from a Windows clipboard ends up on the tail of a line, inside a block's content rather than separating one. Only the delimiter stripping is worth telling the user about; line endings are housekeeping.

**"One character" means one character, not one of the units JavaScript stores them in.** An emoji is two. Deleting one of them leaves a lone surrogate: invalid UTF-16, a replacement character on screen, and once the file is written out it *is* one — unlike almost everything else that can go wrong here, that damage survives to disk. `backOne`/`forwardOne`/`onePoint` in `edits.js` are the answer, and every place that trims a body by a character uses them.

**Edits that undo each other must cancel.** Deleting a word and typing it back leaves no trace, not `{--word--}{++word++}`; `normalize()` in `edits.js` runs on every change.

It compares whole *runs* of touching annotations, not neighbouring pairs. A pairwise check is not enough: retype a word and then add a paragraph break, and the insertion ends up separated from the deletion it cancels by a third annotation, so the document shows four changes whose net effect is none. For each run, compare what it accepts to what it rejects — if they match, it is churn, and the run becomes plain text.

Carrying the caret across a rewrite needs care. Outside the rewritten span it just shifts; inside, it has to be re-found by its position in the *accepted* text, which normalisation preserves exactly. An earlier version shoved it to the end of the span, which dropped it on an offset the rendered view cannot address — so typing one letter jumped the cursor into the next block.

A run that cannot be cancelled is still written once. Deleting a word and typing its replacement leaves a deletion beside an insertion — the same document that selecting the word and typing over it writes as one substitution, split only because the keystrokes arrived in separate bursts. On screen that was a row of adjacent marks with no way to see it was one thought; downstream it was several edits where the writer made one.

Three limits, all deliberate. Cancellation only fires when one side genuinely contains the other, so `alpha -> beta` is not shaved into `alph -> bet` plus a stray "a". A run stops at anything carrying a reason: someone wrote that explanation on purpose, and dissolving the edit beneath it would discard it. And a run holding a **block marker** is never written once, however well it would join: `structure.js` finds the marker a block wears by looking for an annotation whose body opens with one, so folding it into the prose beside it hides it — and the next ⌘⇧8, finding no bullet to replace, writes a second one. The structural fuzz caught that in 151 of 600 sessions. The pattern lives in both modules and a test in `normalize.test.js` holds them to each other.

**Block types are exclusive.** A block is a paragraph, a heading, a list item or a quote — never two at once. Making a bullet into a heading stops it being a bullet, as it would in any other editor. Stacking the markers produced `- ## Title`, which is legal markdown for a list item containing a heading and never what anyone meant. All of it goes through `applyMarker()` in `structure.js`, which also rewrites a marker that is already mid-change rather than nesting a second annotation inside the first.

**Rules go in the pure modules; `app.js` only wires.** `criticmarkup.js` and `edits.js` know about strings and offsets and nothing else — no DOM, no globals. That purity is the only reason the editing model is testable, so any new editing behaviour belongs there with a test, not inline in a handler. The editing model is `(text, caret) → (text, caret)`; keep it that way.

**Test through `test/harness.js`, and only from states a user can reach.** It drives the real editor headlessly — type, press, select, paste — so anything it proves is true of the app. Two traps have now caught four separate attempts at testing this thing, including mine:

- `rejected` is not `source`. On a document that already contains annotations it returns the text *underneath* them. Compare against `ed.original`.
- Offsets index `source`, delimiters included. The caret after typing "X" into `hel|lo` is 7 in `hel{++X++}lo` — right after the X, which is correct. It is not an offset into the rendered text.

The harness now refuses a caret inside markup and skips selections buried in it, because a test built on an unreachable state proves nothing and reads exactly like a real bug.

**Every editing rule gets a test.** `npm test` runs Node's own test runner. The merge rules especially — holding ⌫ growing one deletion instead of a chain, a typing burst producing one insertion, an emptied substitution collapsing back to a deletion — are subtle, easy to regress, and cheap to cover. A browser check is not a substitute; it is the thing you do *after*.

**Some of the layers check things a string comparison cannot.**

`mirror()` in `test/harness.js` runs the real editor and a plain text one — a string, a caret, textbook semantics, written from scratch — over the same keystrokes, and asserts after each that `ed.accepted` equals what a normal editor would have produced. That turns "does this behave like a text editor" from a judgement call into a failing test; it is what caught backspace leaving a stray `-` behind when the bullet it removed was part of a change still in flight. Some keystrokes have no plain-text answer — Enter, arrows, word deletes clamped by markup — and the mirror records them as skipped rather than inventing one. `test/reference.test.js` names the cases; the fuzz runs the same machinery over ten thousand random keystrokes.

`test/render.test.js` draws the document into jsdom and asserts on the nodes. Every text node must hold exactly the visible text at the offset it claims, no delimiter may reach the screen, every character block structure calls text must be on it, and a caret offset must survive a round trip through `sourceToPoint`/`pointToSource`. jsdom does no layout, so anything positional still needs a browser.

`domSession()` in `test/dom.js` puts the renderer and the offset index into the editing loop exactly as `app.js` does, so the same keystrokes can be run twice — once through the editor alone, once through the screen — and compared. That is the only way to see a caret degraded by being drawn.

`test/structure-fuzz.test.js` runs the structural commands *inside* sessions rather than one call at a time from a clean document. They had unit tests and nothing else, and 358 of the first 800 sessions broke something.

**`dist/index.html` is generated. Never edit it by hand.** Run `npm run build`. It is committed on purpose: the product is a file you double-click from disk, so a clone has to be immediately usable without a build.

**The document is the only thing on screen.** There is no header bar: the row of controls sits at the top of the document's own column and sticks there as it scrolls, the file name lives in the tab title, and unsaved work is a dot on Save.

**Icons are Lucide geometry, inlined as an SVG sprite in `index.html`.** One `<symbol>` each, referenced with `<use>`, stroked in `currentColor` so a disabled or inverted button carries its icon with it. Copying the paths rather than depending on the package is what keeps the page one file with no network; the sprite is `display:none`, or it lays out at an SVG's default 300×150 and shoves the whole page down.

**No runtime dependencies, ever.** The page must work offline from `file://` with no network and no CDN. The two devDependencies never reach it: `esbuild` produces the single-file artifact, and `jsdom` gives the render tests a document. The build asserts the output has no external references.

**Docs state the current truth, not its history.** Rewrite lines to say what is now true and delete what isn't. The path lives in git. No "SUPERSEDED" blocks, no tombstones for behaviour that changed.

## Commands

```
npm test            # editing logic, the reference model, and the DOM under jsdom
npm run dev         # static server on :4173 — browsers won't load ES modules over file://
npm run build       # → dist/index.html, self-contained
```

## Checking it in a browser

`npm run dev` and load `http://localhost:4173/`, not the `file://` path — the Chrome extension cannot open `file://` URLs, and ES modules won't load from there anyway. Test the built artifact by serving `dist/index.html` the same way.

Typing must be driven with **real** key events. Synthetic `KeyboardEvent`s do not fire `beforeinput`, so they silently test nothing.

**Bind shortcuts on `e.code`, not `e.key`.** With Shift held the 8 key reports `*` and the 7 key `&` on a US layout, and Alt produces dead keys and symbols on most layouts. A shortcut matched on `e.key` can pass an automated test that sends the digit and still never fire for a real person.

**A plain browser refresh is enough after editing `src/`** — the dev server sends `Cache-Control: no-store` and this is verified, deep modules included. Restart `npm run dev` only when you change the server itself.

**But `import()` from the console reuses the page's module map**, which lives as long as the document. Probing a module you just edited returns the *old* instance, which surfaces as baffling errors like `blocks is not iterable` from code that looks correct on disk. Reload before probing, and never conclude the app is broken from a console import alone.

Two things will freeze an automated session: the native `confirm()` on dropping a file while there are unsaved changes, and the `beforeunload` guard on navigating away. Save or undo to a clean state first.

## Out of scope

Do not build these without being asked. They were considered and cut.

- **Accepting or rejecting annotations.** A different tool's job. Read-only previews of the document with every annotation applied or reverted were built and then cut: nothing acted on them, and `transform()` in `criticmarkup.js` is one call away if they are ever wanted back.
- **Markdown beyond the closed set.** Guarded in two places, and both are needed: structural commands refuse via `structure.js`, and ordinary typing and deletion refuse via `crossesUnsupported()` in `editor.js`. Only the first existed at one point, so a selection dragged from above a code fence to below it swallowed the whole block into a substitution — the text survived, but the island vanished and the document collapsed around it. Headings, paragraphs, bold, italic, inline code, links, bullet and numbered lists, blockquotes, rules. Code fences, tables and raw HTML render as read-only islands and are edited in the Source view. Never guess at structure — a mangled code fence is worse than one you cannot edit in place.
- Multi-file management, git integration, sync, collaboration, mobile, any backend or account.

## Session close

Every session ends by filing per `../hq/PROTOCOL.md` — a session note always, a queue item when Martin's judgment is the blocker.

## Git

Manage git independently — stage, write clear messages, commit, and push at the end of a session without asking. This is a solo repo; commit to `main` directly. Group work into legible thematic commits rather than one catch-all, and never commit with tests failing or `dist/` out of date with `src/`.

**Always ask first** before anything hard to reverse: force-push, history rewrites (`rebase`, `reset --hard`, amending already-pushed commits), branch or tag deletion, or `git rm` of files you didn't create. When unsure whether an action is reversible, treat it as risky and ask.
