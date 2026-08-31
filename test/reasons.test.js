/**
 * Reasons.
 *
 * The whole product is `{location, edit, reason}` triples: an agent downstream
 * reads each annotation and the explanation attached to it. An edit that loses
 * its reason, or wears somebody else's, is worse than no annotation at all.
 *
 * Ordinary editing can never destroy an annotation — deletions refuse to
 * overlap one — so a reason only ever goes when it is deliberately rewritten or
 * the annotation is removed outright from the sidebar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editor } from './harness.js';
import * as edits from '../src/edits.js';
import { parse, hasReason, transform } from '../src/criticmarkup.js';

const reasons = (text) => parse(text).filter(hasReason).map((a) => a.reason);

test('a reason survives editing all around it', () => {
  const doc = 'Alpha {--beta--}{>>too vague<<} gamma delta.\n';
  const ed = editor(doc);
  ed.caretBefore('Alpha').type('Start. ');
  ed.select('gamma').press('Backspace');
  ed.caretAtEnd().type(' More.');
  assert.deepEqual(reasons(ed.source), ['too vague']);
});

test('typing beside a commented edit starts a new one rather than joining it', () => {
  // Merging into it would put someone else's words under an explanation they
  // did not write.
  const ed = editor('Alpha {++added++}{>>needed saying<<} beta.\n');
  ed.caretAfter('{>>needed saying<<}').type('more');
  const anns = parse(ed.source);
  assert.equal(anns.length, 2, 'the new insertion stands on its own');
  assert.equal(anns[1].reason, null, 'and arrives unexplained, as it should');
  assert.deepEqual(reasons(ed.source), ['needed saying']);
});

test('an edit carrying a reason is never dissolved as churn', () => {
  // `normalize` collapses edits that cancel out, but not one somebody explained.
  const ed = editor('Alpha {--beta--}{>>deliberate<<} gamma.\n');
  ed.caretAfter('{>>deliberate<<}').type('beta');
  assert.deepEqual(reasons(ed.source), ['deliberate']);
  assert.ok(ed.source.includes('{--beta--}'), 'the deletion stays, explained');
});

test('writing a reason, changing it, and clearing it', () => {
  const ed = editor('Alpha {--beta--} gamma.\n');
  const start = parse(ed.source)[0].start;
  ed.apply(edits.setReason(ed.source, start, 'too vague', ed.caret));
  assert.deepEqual(reasons(ed.source), ['too vague']);
  ed.apply(edits.setReason(ed.source, start, 'clearer', ed.caret));
  assert.deepEqual(reasons(ed.source), ['clearer']);
  ed.apply(edits.setReason(ed.source, start, '', ed.caret));
  assert.deepEqual(reasons(ed.source), [], 'and the comment goes with it');
  assert.equal(ed.source, 'Alpha {--beta--} gamma.\n');
});

test('removing an annotation takes its reason and restores the text', () => {
  const doc = 'Alpha {--beta--}{>>too vague<<} gamma.\n';
  const ed = editor(doc);
  ed.apply(edits.removeAnnotation(ed.source, parse(ed.source)[0].start));
  assert.equal(ed.source, 'Alpha beta gamma.\n');
  assert.equal(ed.rejected, ed.original, 'and the document is untouched underneath');
});

/* --- and over random sessions --------------------------------------------- */

const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const DOCS = [
  'Alpha {--beta--}{>>too vague<<} gamma delta.\n',
  '# T\n\nOne {~~old~>new~~}{>>clearer<<} two three.\n\nFour five.\n',
  'A {++added++}{>>needed saying<<} and a {--cut--}{>>redundant<<} here.\n',
];
const KEYS = ['Backspace', 'Delete', 'Enter', 'Alt+Backspace', 'Alt+Delete'];
const WORDS = ['a', 'x', 'the ', '\n'];

const lost = [];
for (let session = 0; session < 300; session++) {
  const rnd = mulberry32(session * 7717 + 3);
  const doc = DOCS[Math.floor(rnd() * DOCS.length)];
  const ed = editor(doc);
  const before = reasons(doc);

  for (let step = 0; step < 18; step++) {
    const roll = rnd();
    try {
      if (roll < 0.4) ed.type(WORDS[Math.floor(rnd() * WORDS.length)]);
      else if (roll < 0.75) ed.press(KEYS[Math.floor(rnd() * KEYS.length)]);
      else {
        const words = ed.accepted.split(/\s+/).filter((w) => w.length > 2);
        if (!words.length) continue;
        ed.select(words[Math.floor(rnd() * words.length)]);
      }
    } catch { continue; }
  }

  const after = reasons(ed.source);
  const missing = before.filter((r) => !after.includes(r));
  if (missing.length) lost.push({ session, doc, missing, source: ed.source });
}

test('300 random editing sessions never lose a reason', () => {
  const report = lost.slice(0, 3)
    .map((f) => `session ${f.session}: lost ${JSON.stringify(f.missing)}\n  ${JSON.stringify(f.source)}`)
    .join('\n\n');
  assert.equal(lost.length, 0, `${lost.length} sessions dropped an explanation somebody wrote\n\n${report}`);
});
