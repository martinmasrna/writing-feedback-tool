/**
 * Characters that do not fit in one of the units JavaScript stores text in.
 *
 * An emoji is two. Deleting one of them leaves a lone surrogate: invalid
 * UTF-16, which shows on screen as a replacement character and, once the file
 * is written out, *is* one. The emoji never comes back, and unlike most bugs
 * here the damage survives to disk.
 *
 * Every place that deletes "one character" therefore has to mean one as a
 * reader counts them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editor } from './harness.js';
import { parse } from '../src/criticmarkup.js';

/** A high surrogate with no low one after it, or the reverse. */
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
const intact = (ed) => assert.equal(LONE.test(ed.source), false,
  `the source holds half a character: ${JSON.stringify(ed.source)}`);

const DOC = 'Hi 👋 there.\n';
const AFTER = DOC.indexOf('👋') + 2;

test('backspacing over an emoji takes the whole emoji', () => {
  const ed = editor(DOC).caretAt(AFTER).press('Backspace');
  assert.equal(ed.source, 'Hi {--👋--} there.\n');
  intact(ed);
});

test('forward delete takes the whole emoji', () => {
  const ed = editor(DOC).caretAt(DOC.indexOf('👋')).press('Delete');
  assert.equal(ed.source, 'Hi {--👋--} there.\n');
  intact(ed);
});

test('backspacing over an emoji you just typed removes all of it', () => {
  const ed = editor('Hi  there.\n').caretAt(3).type('🎉');
  assert.equal(ed.source, 'Hi {++🎉++} there.\n');
  ed.press('Backspace');
  assert.equal(ed.source, 'Hi  there.\n', 'the insertion goes entirely, not half');
  intact(ed);
});

test('an emoji at the far edge of an insertion is not trimmed in half', () => {
  // The caret sits just past `++}`, so backspace trims the body rather than
  // striking text out — and the body ends in an emoji.
  const ed = editor('Hi  there.\n').caretAt(3).type('a🎉');
  const past = ed.source.indexOf('++}') + 3;
  ed.caretAt(past).press('Backspace');
  assert.equal(ed.source, 'Hi {++a++} there.\n');
  intact(ed);
});

test('an emoji at the near edge of an insertion survives a forward delete', () => {
  const ed = editor('Hi  there.\n').caretAt(3).type('🎉a');
  const before = ed.source.indexOf('{++');
  ed.caretAt(before).press('Delete');
  assert.equal(ed.source, 'Hi {++a++} there.\n');
  intact(ed);
});

test('a substitution whose replacement ends in an emoji', () => {
  const ed = editor('Hi there.\n').select('there').type('all 🎉');
  ed.press('Backspace');
  assert.equal(ed.source, 'Hi {~~there~>all ~~}.\n');
  intact(ed);
});

/* --- and over random sessions ---------------------------------------------- */

const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const DOCS = [
  'Hi 👋 there 🎉 friends.\n',
  '# 🚀 Launch\n\n- 👍 one\n- 👎 two\n\n🧪 trailing.\n',
  'Mixed 👋 with {--struck 🎉--} and {++added 🚀++} here.\n',
  'Family 👨‍👩‍👧 and flag 🇬🇧 and accent é.\n',
];
const KEYS = ['Backspace', 'Delete', 'Enter', 'Alt+Backspace', 'Alt+Delete', 'Cmd+Backspace', 'ArrowLeft', 'ArrowRight'];
const WORDS = ['a', 'x', '🎈', 'the ', '\n'];

const broken = [];
for (let session = 0; session < 400; session++) {
  const rnd = mulberry32(session * 7919 + 55);
  const ed = editor(DOCS[Math.floor(rnd() * DOCS.length)]);
  for (let step = 0; step < 16; step++) {
    try {
      const roll = rnd();
      if (roll < 0.35) ed.type(WORDS[Math.floor(rnd() * WORDS.length)]);
      else if (roll < 0.75) ed.press(KEYS[Math.floor(rnd() * KEYS.length)]);
      else {
        const words = ed.accepted.split(/\s+/).filter((w) => w.length > 1);
        if (words.length) ed.select(words[Math.floor(rnd() * words.length)]);
      }
    } catch { continue; }
    const problems = [];
    if (LONE.test(ed.source)) problems.push('a lone surrogate');
    if (ed.rejected !== ed.original) problems.push('the original is gone');
    for (const a of parse(ed.source)) if (a.type !== 'com' && a.a === '' && a.b === '') problems.push('an empty annotation');
    if (problems.length) { broken.push({ session, source: ed.source, problems }); break; }
  }
}

test('400 sessions on documents full of emoji never split one', () => {
  const report = broken.slice(0, 3)
    .map((f) => `session ${f.session}: ${f.problems.join('; ')}\n  ${JSON.stringify(f.source)}`).join('\n\n');
  assert.equal(broken.length, 0, `${broken.length} sessions damaged a character\n\n${report}`);
});
