# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## What this is

A markdown review tool. You open a document written by someone (usually an AI agent), edit it like a normal text editor, and every change is recorded in the file itself as CriticMarkup with a reason attached. Downstream, an agent reads each annotation as a `{location, edit, reason}` triple.

The name `redline` is a **placeholder** — it is the correct industry term, but it is also
taken by adjacent markdown-review projects. Nothing depends on it. Don't build identity
around it, and don't reopen the question unasked.

**The annotated `.md` file is the entire state.** No database, no export step. Annotations are re-derived from the text on every change rather than stored beside it, so the file and the UI cannot drift apart. If you find yourself caching parsed annotations anywhere but `state.js`, stop.

## Two invariants hold the design up

Break either one and the editor corrupts documents. Read these before touching `src/dom/` or `src/input.js`.

**Every source character is rendered exactly once, in order.** Delimiters are dimmed, never hidden. This is what makes DOM-position → source-offset a running sum over text nodes (`dom/offsets.js`). Anything on screen that is *not* backed by source text — the `NO REASON` chip — must carry `data-virtual` so the offset walker skips it.

**The browser never mutates the document.** `#doc` is `contenteditable`, but every `beforeinput` is cancelled and translated into an operation on the markdown string, which is then re-rendered from scratch. Anything that must not be edited — delimiters, struck text, comment chips — is `contenteditable="false"` so the caret cannot get inside markup. Never let a browser-native edit through.

## What to read, and when

**Read nothing up front beyond this file.** Pull only what the task needs.

| task | context |
|---|---|
| the markup syntax, parsing, offsets | `src/criticmarkup.js` — pure, and the vocabulary everything else uses |
| what a keystroke does | `src/edits.js` — pure; the merge rules live here |
| caret lands in the wrong place after an edit | `src/dom/offsets.js`, then the two invariants above |
| a keystroke does nothing or the wrong thing | `src/input.js` — the `beforeinput` switch |
| undo granularity, dirty state, history | `src/state.js` |
| what the annotated file looks like on screen | `src/dom/render.js` |
| open, save, save-in-place, drag-and-drop | `src/files.js` |
| how it all connects | `src/app.js` — orchestration only, no rules |

## Conventions

**Rules go in the pure modules; `app.js` only wires.** `criticmarkup.js` and `edits.js` know about strings and offsets and nothing else — no DOM, no globals. That purity is the only reason the editing model is testable, so any new editing behaviour belongs there with a test, not inline in a handler. The editing model is `(text, caret) → (text, caret)`; keep it that way.

**Every editing rule gets a test.** `npm test` runs Node's own test runner with no browser and no deps. The merge rules especially — holding ⌫ growing one deletion instead of a chain, a typing burst producing one insertion, an emptied substitution collapsing back to a deletion — are subtle, easy to regress, and cheap to cover. A browser check is not a substitute; it is the thing you do *after*.

**`dist/index.html` is generated. Never edit it by hand.** Run `npm run build`. It is committed on purpose: the product is a file you double-click from disk, so a clone has to be immediately usable without a build.

**No runtime dependencies, ever.** The page must work offline from `file://` with no network and no CDN. `esbuild` is the one devDependency and exists only to produce the single-file artifact; the build asserts the output has no external references.

**Docs state the current truth, not its history.** Rewrite lines to say what is now true and delete what isn't. The path lives in git. No "SUPERSEDED" blocks, no tombstones for behaviour that changed.

## Commands

```
npm test            # pure logic; no browser needed
npm run dev         # static server on :4173 — browsers won't load ES modules over file://
npm run build       # → dist/index.html, self-contained
```

## Checking it in a browser

`npm run dev` and load `http://localhost:4173/`, not the `file://` path — the Chrome extension cannot open `file://` URLs, and ES modules won't load from there anyway. Test the built artifact by serving `dist/index.html` the same way.

Typing must be driven with **real** key events. Synthetic `KeyboardEvent`s do not fire `beforeinput`, so they silently test nothing.

Two things will freeze an automated session: the native `confirm()` on dropping a file while there are unsaved changes, and the `beforeunload` guard on navigating away. Save or undo to a clean state first.

## Out of scope

Do not build these without being asked. They were considered and cut.

- **Accepting or rejecting annotations.** A different tool's job. `Accepted`/`Rejected` in the header are previews only.
- **A rendered-markdown editing view.** Selection must map one-to-one onto source offsets; mapping a rendered view back to source is explicitly out.
- Multi-file management, git integration, sync, collaboration, mobile, any backend or account.

## Git

Manage git independently — stage, write clear messages, commit, and push at the end of a session without asking. This is a solo repo; commit to `main` directly. Group work into legible thematic commits rather than one catch-all, and never commit with tests failing or `dist/` out of date with `src/`.

**Always ask first** before anything hard to reverse: force-push, history rewrites (`rebase`, `reset --hard`, amending already-pushed commits), branch or tag deletion, or `git rm` of files you didn't create. When unsure whether an action is reversible, treat it as risky and ask.
