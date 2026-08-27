# GATES

## One-way doors

- **What each CriticMarkup delimiter means** (`{++inserted++}`, `{--deleted--}`, `{~~old~>new~~}`, `{==highlight==}{>>comment<<}`). The annotated file *is* the app's entire state, and files annotated with today's meaning already sit on people's disks (real use started 2026-08-24). Changing what a delimiter means doesn't just change the app — it silently changes what every existing annotated file says, and breaks the `{location, edit, reason}` triple a downstream agent reads from it.
- **The round-trip promise: reject every annotation and you get back exactly the file you opened.** This is the one guarantee the README makes, and it's what makes it safe to open a document and start marking it up. It's already enforced in code (`preservesOriginal()` refuses any operation that would break it) — any change that could weaken that guarantee needs Martin's eyes before it ships, not just a passing test.
- **Which markdown the editor understands directly versus treats as a read-only island** (code fences, tables, raw HTML). Widening this changes which real documents can be safely opened and annotated at all — get it wrong and a file loses structure instead of gaining a tracked change, which reads as data loss, not a bug.

## Delivery vs discovery

**Delivery** (the fix is known — an agent builds it, tests and cross-review judge it):
- Add in-app assertions that check the invariants after every render and log loudly when one breaks (TODO #1).
- Delete `test/render-contract.test.js`, keeping the two annotation tests it has that `test/render.test.js` doesn't cover elsewhere.
- Manually run through the paths nobody's checked in a real browser yet — IME composition, Shift+Arrow selection, the reason prompt in the rendered view, save-in-place through the File System Access API, toolbar/dialog positioning — against the behavior already written down in CLAUDE.md and the README. The correct behavior is already known; this is confirming it works, not exploring what it should do.

**Discovery** (nobody knows the answer yet — small tries, a written question, a stop-rule):
- Getting automated coverage for `offsets.vertical()` (Up/Down caret movement). It's driven by hand against real Chrome layout because Chrome's own key handling is unreliable and `caretRangeFromPoint` doesn't exist in jsdom — nobody currently knows a way to simulate that in a test, so this needs small cheap attempts at a testing approach, not a build task with a known shape.
- Each round of real use: open a real document, edit it for ten minutes, see what breaks. Per TODO.md this has found sharper bugs than any automated pass — nobody knows what's still broken until Martin (or an agent) hits it, so each round is a cheap try with the verdict being whatever bug turns up, not a scheduled deliverable.
