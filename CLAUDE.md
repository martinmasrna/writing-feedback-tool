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

**Every text node the renderer creates carries a source mapping.** The source view can map DOM to source with a running sum because it renders every character; the rendered view drops `**` and `#` from the screen, so it emits explicit mappings instead (`dom/offsets.js` takes either). Anything on screen *not* backed by source text — bullets, comment chips, the `NO REASON` marker, island labels — must carry `data-virtual` so the caret cannot address it.

**The browser never mutates the document.** `#doc` is `contenteditable`, but every `beforeinput` is cancelled and translated into an operation on the markdown string, which is then re-rendered from scratch. Anything that must not be edited — struck text, comment chips, unsupported blocks — is `contenteditable="false"` so the caret cannot get inside markup. Never let a browser-native edit through.

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
| caret lands in the wrong place after an edit | `src/dom/offsets.js`, then the two invariants above |
| a keystroke does nothing or the wrong thing | `src/input.js` — the `beforeinput` switch |
| undo granularity, dirty state, history | `src/state.js` |
| what the annotated file looks like on screen | `src/dom/render.js` |
| open, save, save-in-place, drag-and-drop | `src/files.js` |
| how it all connects | `src/app.js` — orchestration only, no rules |
| testing an editing rule | `test/harness.js` — `editor()` to drive it, `mirror()` to hold it against a plain text editor |
| testing what reaches the screen | `test/dom.js`, then `test/render.test.js` |

## Conventions

**Never interrupt editing to ask for a reason.** Reasons are a review-time act, not a typing-time one — people press Enter for room, write, delete half of it, come back ten minutes later. An earlier build prompted whenever the cursor left an edit; it re-armed itself on the next cursor move and became inescapable. Unexplained edits are *marked* — inline, in the sidebar, and in the header counter — and explained when the writing is done.

**A change must be visible the instant it is made.** Several ways this went wrong, both of which read to the user as "the key did nothing": striking one newline out of a `\n\n` block separator left the screen identical, and an arrow key aimed at an offset the rendered view cannot address snapped straight back. Backspace at the top of a block now removes the whole separator and the blocks visibly join — `splitLines` ignores deleted line breaks, so they stop separating anything — and `offsets.step()` walks only positions that exist on screen. Pressing Enter for space was a third: the renderer skipped blank blocks entirely, so extra blank lines produced no DOM at all. One blank line between two blocks is the separator and stays invisible; every further one renders as an empty paragraph you can put the caret in.

If an edit or a keystroke produces no visible change, that is a bug even when the source is correct.

**Caret movement across markup is ours to drive, not the browser's.** Struck text and comment chips are `contenteditable="false"`, and Chrome will neither put the caret inside them *nor step over them* — an arrow press beside a deletion does nothing at all, and the next keystroke lands wherever the caret was stuck. `stepCaret()` in `edits.js` moves it: plain text one character at a time, a run of finished markup skipped whole in a single press. Any new unedittable region must be reachable past, or it becomes a wall.

**Edits that undo each other must cancel.** Deleting a word and typing it back leaves no trace, not `{--word--}{++word++}`; `normalize()` in `edits.js` runs on every change.

It compares whole *runs* of touching annotations, not neighbouring pairs. A pairwise check is not enough: retype a word and then add a paragraph break, and the insertion ends up separated from the deletion it cancels by a third annotation, so the document shows four changes whose net effect is none. For each run, compare what it accepts to what it rejects — if they match, it is churn, and the run becomes plain text.

Carrying the caret across a rewrite needs care. Outside the rewritten span it just shifts; inside, it has to be re-found by its position in the *accepted* text, which normalisation preserves exactly. An earlier version shoved it to the end of the span, which dropped it on an offset the rendered view cannot address — so typing one letter jumped the cursor into the next block.

Two limits, both deliberate. Cancellation only fires when one side genuinely contains the other, so `alpha -> beta` is not shaved into `alph -> bet` plus a stray "a". And a run stops at anything carrying a reason: someone wrote that explanation on purpose, and dissolving the edit beneath it would discard it.

**Block types are exclusive.** A block is a paragraph, a heading, a list item or a quote — never two at once. Making a bullet into a heading stops it being a bullet, as it would in any other editor. Stacking the markers produced `- ## Title`, which is legal markdown for a list item containing a heading and never what anyone meant. All of it goes through `applyMarker()` in `structure.js`, which also rewrites a marker that is already mid-change rather than nesting a second annotation inside the first.

**Rules go in the pure modules; `app.js` only wires.** `criticmarkup.js` and `edits.js` know about strings and offsets and nothing else — no DOM, no globals. That purity is the only reason the editing model is testable, so any new editing behaviour belongs there with a test, not inline in a handler. The editing model is `(text, caret) → (text, caret)`; keep it that way.

**Test through `test/harness.js`, and only from states a user can reach.** It drives the real editor headlessly — type, press, select, paste — so anything it proves is true of the app. Two traps have now caught four separate attempts at testing this thing, including mine:

- `rejected` is not `source`. On a document that already contains annotations it returns the text *underneath* them. Compare against `ed.original`.
- Offsets index `source`, delimiters included. The caret after typing "X" into `hel|lo` is 7 in `hel{++X++}lo` — right after the X, which is correct. It is not an offset into the rendered text.

The harness now refuses a caret inside markup and skips selections buried in it, because a test built on an unreachable state proves nothing and reads exactly like a real bug.

**Every editing rule gets a test.** `npm test` runs Node's own test runner. The merge rules especially — holding ⌫ growing one deletion instead of a chain, a typing burst producing one insertion, an emptied substitution collapsing back to a deletion — are subtle, easy to regress, and cheap to cover. A browser check is not a substitute; it is the thing you do *after*.

**Two of the layers check things a string comparison cannot.**

`mirror()` in `test/harness.js` runs the real editor and a plain text one — a string, a caret, textbook semantics, written from scratch — over the same keystrokes, and asserts after each that `ed.accepted` equals what a normal editor would have produced. That turns "does this behave like a text editor" from a judgement call into a failing test; it is what caught backspace leaving a stray `-` behind when the bullet it removed was part of a change still in flight. Some keystrokes have no plain-text answer — Enter, arrows, word deletes clamped by markup — and the mirror records them as skipped rather than inventing one. `test/reference.test.js` names the cases; the fuzz runs the same machinery over ten thousand random keystrokes.

`test/render.test.js` draws the document into jsdom and asserts on the nodes. Every text node must hold exactly the visible text at the offset it claims, no delimiter may reach the screen, every character block structure calls text must be on it, and a caret offset must survive a round trip through `sourceToPoint`/`pointToSource`. jsdom does no layout, so anything positional still needs a browser.

**`dist/index.html` is generated. Never edit it by hand.** Run `npm run build`. It is committed on purpose: the product is a file you double-click from disk, so a clone has to be immediately usable without a build.

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

- **Accepting or rejecting annotations.** A different tool's job. `Accepted`/`Rejected` in the header are previews only.
- **Markdown beyond the closed set.** Guarded in two places, and both are needed: structural commands refuse via `structure.js`, and ordinary typing and deletion refuse via `crossesUnsupported()` in `editor.js`. Only the first existed at one point, so a selection dragged from above a code fence to below it swallowed the whole block into a substitution — the text survived, but the island vanished and the document collapsed around it. Headings, paragraphs, bold, italic, inline code, links, bullet and numbered lists, blockquotes, rules. Code fences, tables and raw HTML render as read-only islands and are edited in the Source view. Never guess at structure — a mangled code fence is worse than one you cannot edit in place.
- Multi-file management, git integration, sync, collaboration, mobile, any backend or account.

## Git

Manage git independently — stage, write clear messages, commit, and push at the end of a session without asking. This is a solo repo; commit to `main` directly. Group work into legible thematic commits rather than one catch-all, and never commit with tests failing or `dist/` out of date with `src/`.

**Always ask first** before anything hard to reverse: force-push, history rewrites (`rebase`, `reset --hard`, amending already-pushed commits), branch or tag deletion, or `git rm` of files you didn't create. When unsure whether an action is reversible, treat it as risky and ask.
