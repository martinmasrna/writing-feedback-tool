/**
 * The caret's round trip through the screen.
 *
 * `app.js` re-renders after every edit, writes the caret into the DOM, and —
 * because writing a selection fires `selectionchange` — reads it straight back.
 * The rendered view cannot represent every source offset: the end of an
 * insertion body and the position past its closing delimiter are the same place
 * on screen, and a `**`, a block marker or the line break between two blocks is
 * not drawn at all. So that round trip is lossy, and what comes back is what
 * the *next* keystroke gets applied to.
 *
 * No string test can see this — the loss only exists once there is a DOM. These
 * run the same keystrokes twice, once through `editor()` alone and once through
 * `domSession()`, which puts the real renderer and the real offset index in the
 * loop exactly as the app does. The two must agree.
 *
 * Before the caret was guarded, 427 of 500 random sessions disagreed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { domSession } from './dom.js';
import { editor } from './harness.js';

/** Run the same script both ways and demand the same document. */
function bothWays(initial, script) {
  const pure = editor(initial);
  const thru = domSession(initial);
  for (const step of script) { step(pure); step(thru); }
  assert.equal(thru.ed.source, pure.source,
    'the screen changed what the document became');
  return thru;
}

const scenarios = [
  ['pressing Enter twice and typing', '# T\n\nBody text here.\n\nSecond paragraph.\n',
    [(e) => e.caretBefore('Body'), (e) => e.press('Enter'), (e) => e.press('Enter'), (e) => e.type('NEW')]],
  ['deleting a word forward and typing the replacement', '# T\n\nAlpha beta gamma.\n\nSecond paragraph.\n',
    [(e) => e.caretBefore('gamma'), (e) => e.press('Alt+Delete'), (e) => e.type('delta')]],
  ['removing a bullet and carrying on', '- one\n- two\n',
    [(e) => e.select('two'), (e) => e.press('Enter'), (e) => e.press('Backspace'), (e) => e.type('three')]],
  ['editing beside an existing change', 'Text with {~~old~>new~~} replacement.\n',
    [(e) => e.caretAfter('replacement.'), (e) => e.press('Backspace', 4), (e) => e.type('ments')]],
  ['typing at the head of a heading', '## Summary\n\nBody.\n',
    [(e) => e.caretBefore('Summary'), (e) => e.type('Short '), (e) => e.press('Backspace', 2)]],
  ['deleting into emphasis', 'A **bold** word here.\n',
    [(e) => e.caretAfter('word'), (e) => e.press('Alt+Backspace'), (e) => e.type('phrase')]],
];

for (const [name, doc, script] of scenarios) {
  test(`the screen does not change what ${name} does`, () => {
    bothWays(doc, script);
  });
}

test('the round trip really is lossy, so the guard is load-bearing', () => {
  // If this ever stops holding, the rendered view has become able to represent
  // every offset and the guard could go. Until then it is the only thing
  // keeping the caret precise.
  const thru = bothWays('# T\n\nBody text here.\n',
    [(e) => e.caretBefore('Body'), (e) => e.press('Enter'), (e) => e.press('Enter')]);
  assert.ok(thru.readings.some((r) => r.read !== r.held),
    'no reading differed from what was held — the premise of this file is gone');
});

/* --- and the same thing over random sessions ------------------------------ */

const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const DOCS = [
  '# Title\n\nA paragraph with some words in it.\n',
  '## Heading\n\n- one\n- two\n\nTrailing paragraph.\n',
  '# T\n\nPara one.\n\nPara two.\n\n- bullet\n',
  'Text with {~~old~>new~~} replacement.\n',
  'Already {--struck--} and {++added++} here.\n',
];
const KEYS = ['Backspace', 'Delete', 'Enter', 'Alt+Backspace', 'Alt+Delete', 'Cmd+Backspace'];
const WORDS = ['a', 'the', 'x', 'hello ', '\n', '*', '`'];

const failures = [];
for (let session = 0; session < 150; session++) {
  const rnd = mulberry32(session * 7919 + 13);
  const doc = DOCS[Math.floor(rnd() * DOCS.length)];

  // One script, replayed against both, so the comparison is exact.
  const script = [];
  for (let step = 0; step < 15; step++) {
    const roll = rnd();
    if (roll < 0.4) { const w = WORDS[Math.floor(rnd() * WORDS.length)]; script.push((e) => e.type(w)); }
    else if (roll < 0.8) { const k = KEYS[Math.floor(rnd() * KEYS.length)]; script.push((e) => e.press(k)); }
    else {
      const pick = rnd();
      script.push((e) => {
        const words = (e.ed ? e.ed.accepted : e.accepted).split(/\s+/).filter((w) => w.length > 2);
        if (words.length) e.select(words[Math.floor(pick * words.length)]);
      });
    }
  }

  const pure = editor(doc);
  const thru = domSession(doc);
  for (const step of script) {
    try { step(pure); } catch { /* refused; the other run sees the same */ }
    try { step(thru); } catch { /* refused */ }
  }
  if (pure.source !== thru.ed.source) failures.push({ session, doc, pure: pure.source, thru: thru.ed.source });
}

test('150 random sessions survive the round trip through the screen', () => {
  const report = failures.slice(0, 3).map((f) => [
    `session ${f.session} on ${JSON.stringify(f.doc)}`,
    `  without the screen: ${JSON.stringify(f.pure)}`,
    `  with it:            ${JSON.stringify(f.thru)}`,
  ].join('\n')).join('\n\n');
  assert.equal(failures.length, 0, `${failures.length} sessions came out different\n\n${report}`);
});
