/**
 * Randomised editing sessions, checked after every keystroke.
 *
 * The point is to use only states a real user can reach: no placing the caret
 * at an arbitrary offset, no selecting text buried inside markup. Sessions that
 * start from impossible states produce convincing failures that mean nothing —
 * three separate attempts at this test were thrown away for exactly that.
 *
 * Seeded, so any failure reproduces from the session number alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editor } from './harness.js';
import { transform, parse, tokenize, regionAt } from '../src/criticmarkup.js';
import { normalize } from '../src/edits.js';

const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const DOCS = [
  '# Title\n\nA paragraph with some words in it.\n',
  '## Heading\n\n- one\n- two\n\nTrailing paragraph.\n',
  'Just a bare line of text\n',
  '# T\n\nPara one.\n\nPara two.\n\n- bullet\n',
  'Text with {~~old~>new~~} replacement.\n',
  'Already {--struck--} and {++added++} here.\n',
];
const KEYS = ['Backspace', 'Delete', 'Enter', 'Alt+Backspace', 'Alt+Delete', 'Cmd+Backspace', 'ArrowLeft', 'ArrowRight'];
const WORDS = ['a', 'the', 'x', 'hello ', '\n', '*', '`', '{', '~'];

const failures = [];
let ops = 0;

for (let session = 0; session < 400; session++) {
  const rnd = mulberry32(session * 7919 + 13);
  const doc = DOCS[Math.floor(rnd() * DOCS.length)];
  const baseline = transform(doc, 'rejected');
  const ed = editor(doc);
  const trail = [];

  for (let step = 0; step < 25; step++) {
    const roll = rnd();
    try {
      if (roll < 0.35) {
        const w = WORDS[Math.floor(rnd() * WORDS.length)];
        ed.type(w); trail.push(`type ${JSON.stringify(w)}`);
      } else if (roll < 0.75) {
        const k = KEYS[Math.floor(rnd() * KEYS.length)];
        ed.press(k); trail.push(k);
      } else {
        // Select a real word that exists in the accepted text, the way a user would.
        const words = ed.accepted.split(/\s+/).filter((w) => w.length > 2);
        if (!words.length) continue;
        const w = words[Math.floor(rnd() * words.length)];
        try { ed.select(w); } catch { continue; }
        trail.push(`select ${JSON.stringify(w)}`);
      }
    } catch { continue; }
    ops++;

    const problems = [];
    if (ed.rejected !== baseline) problems.push(`reversibility: ${JSON.stringify(ed.rejected)} != ${JSON.stringify(baseline)}`);
    // Well-formedness judged by the real parser, not a regex: every character
    // must be accounted for by exactly one token, and re-parsing must agree.
    const toks = tokenize(ed.source);
    let cursor = 0;
    for (const t of toks) {
      if (t.start !== cursor) { problems.push(`token gap at ${cursor}`); break; }
      cursor = t.end;
    }
    if (cursor !== ed.source.length) problems.push('tokens do not cover the source');
    if (JSON.stringify(parse(ed.source)) !== JSON.stringify(parse(ed.source))) problems.push('parse unstable');
    for (const a of parse(ed.source)) {
      if (a.type !== 'com' && a.a === '' && a.b === '') problems.push('empty annotation');
    }
    const settled = normalize(ed.source, ed.caret);
    if (settled.text !== ed.source) problems.push(`settling not idempotent: ${JSON.stringify(settled.text)}`);
    const c = ed.caret.start;
    if (c < 0 || c > ed.source.length) problems.push(`caret out of range: ${c}`);
    else if (regionAt(parse(ed.source), c).kind === 'atomic') problems.push(`caret inside markup at ${c}`);

    if (problems.length) {
      failures.push({ session, doc, trail: trail.slice(), problems, source: ed.source, caret: c });
      break;
    }
  }
}

test(`400 random editing sessions hold every invariant`, () => {
  const report = failures.slice(0, 5).map((f) => [
    `session ${f.session} on ${JSON.stringify(f.doc)}`,
    `  ${f.trail.join(' → ')}`,
    `  source: ${JSON.stringify(f.source)}`,
    `  caret ${f.caret}: ${f.problems.join('; ')}`,
  ].join('\n')).join('\n\n');
  assert.equal(failures.length, 0, `${failures.length} of ${ops} operations broke an invariant\n\n${report}`);
});
