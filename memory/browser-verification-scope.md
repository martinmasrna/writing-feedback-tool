---
name: browser-verification-scope
description: Only run the full browser check for big changes or when Martin is away; ship small UI tweaks and let him look
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 695f1ad6-9e40-460a-8f5f-b81f28cb9461
  modified: 2026-08-20T18:04:26.843Z
---

For small UI changes, make the edit, run `npm test`, build, and hand it over — don't
drive the browser through every variant to confirm it. Martin checks those himself
while he is at the keyboard. Reserve the full browser pass (screenshots, each dialog
state, each view) for large or risky changes, or for work done while he is away
overnight.

**Why:** he was iterating with me in real time on the sidebar and dialog chrome, and
my per-variant screenshotting was slower than his own glance at the page.

**How to apply:** default to tests + build + a one-line summary of what to look at.
Escalate to browser verification when the change touches editing behaviour, caret
handling, or several surfaces at once — not for colours, labels and copy.
