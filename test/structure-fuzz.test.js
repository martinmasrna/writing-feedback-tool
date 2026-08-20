/**
 * Structural commands, mixed into random editing sessions.
 *
 * ⌘B, ⌘⇧8, ⌘⌥1–6 had unit tests — one call at a time, from a clean document —
 * and that was the whole of their coverage. What they had never been asked to
 * do was run *after* a few edits, on a document where the markers themselves
 * are mid-change and the caret is sitting inside an annotation. Doing that
 * broke 358 of the first 800 sessions, mostly by nesting one annotation inside
 * another, which does not parse and loses text on reject.
 *
 * They reach the document through `ed.apply()`, the same path `store.apply()`
 * gives them in the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editor } from './harness.js';
import * as structure from '../src/structure.js';
import { normalize } from '../src/edits.js';
import { transform, parse, tokenize, regionAt } from '../src/criticmarkup.js';

const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const DOCS = [
  '# Title\n\nA paragraph with some words.\n',
  '## Heading\n\n- one\n- two\n\nTrailing paragraph.\n',
  '# T\n\nPara one.\n\n> a quote\n\n1. first\n2. second\n',
  'Plain text only.\n',
  'Text with {~~old~>new~~} replacement.\n',
];

/** Two block markers on one line — `- ## Title`, which nobody ever means. */
function stacked(line) {
  const m = /^[ \t]*([-*+]|\d{1,9}[.)]|#{1,6}|>)[ \t]+/.exec(line);
  return !!m && /^([-*+]|\d{1,9}[.)]|#{1,6})[ \t]+/.test(line.slice(m[0].length));
}
const stackedLines = (text) => text.split('\n').filter(stacked).length;

const failures = [];
let ops = 0;

for (let session = 0; session < 600; session++) {
  const rnd = mulberry32(session * 31337 + 11);
  const doc = DOCS[Math.floor(rnd() * DOCS.length)];
  const ed = editor(doc);
  const baseline = transform(doc, 'rejected');
  const trail = [];

  for (let step = 0; step < 20; step++) {
    const before = ed.source;
    let structural = false;
    const roll = rnd();
    try {
      if (roll < 0.25) {
        const words = ed.accepted.split(/\s+/).filter((w) => w.length > 2);
        if (!words.length) continue;
        ed.select(words[Math.floor(rnd() * words.length)]);
        trail.push('select');
      } else if (roll < 0.4) {
        ed.type(['a', 'x', 'the '][Math.floor(rnd() * 3)]);
        trail.push('type');
      } else if (roll < 0.5) {
        ed.press(['Backspace', 'Delete', 'Enter'][Math.floor(rnd() * 3)]);
        trail.push('key');
      } else {
        const pick = rnd();
        let result;
        if (pick < 0.3) { result = structure.toggleBullet(ed.source, ed.caret, {}); trail.push('bullet'); }
        else if (pick < 0.5) { result = structure.toggleBullet(ed.source, ed.caret, { ordered: true }); trail.push('numbered'); }
        else if (pick < 0.85) { const lv = Math.floor(rnd() * 7); result = structure.setHeadingLevel(ed.source, ed.caret, lv); trail.push(`h${lv}`); }
        else { result = structure.toggleEmphasis(ed.source, ed.caret, rnd() < 0.5 ? 'strong' : 'em'); trail.push('emphasis'); }
        ed.apply(result);
        structural = true;
      }
    } catch { continue; }
    ops++;

    const problems = [];
    if (ed.rejected !== baseline) problems.push(`reversibility: ${JSON.stringify(ed.rejected)}`);
    let cursor = 0;
    for (const t of tokenize(ed.source)) { if (t.start !== cursor) { problems.push('token gap'); break; } cursor = t.end; }
    if (cursor !== ed.source.length) problems.push('tokens do not cover the source — markup is nested or broken');
    for (const a of parse(ed.source)) if (a.type !== 'com' && a.a === '' && a.b === '') problems.push('empty annotation');
    if (normalize(ed.source, ed.caret).text !== ed.source) problems.push('settling not idempotent');
    const c = ed.caret.start;
    if (c < 0 || c > ed.source.length) problems.push(`caret out of range: ${c}`);
    else if (regionAt(parse(ed.source), c).kind === 'atomic') problems.push(`caret inside markup at ${c}`);
    // Block types are exclusive — but only the structural commands are held to
    // it. Splitting a line whose text happens to begin `# ` is an ordinary edit.
    if (structural && stackedLines(ed.accepted) > stackedLines(transform(before, 'accepted'))) {
      problems.push(`stacked markers: ${JSON.stringify(ed.accepted.split('\n').filter(stacked).join(' | '))}`);
    }

    if (problems.length) { failures.push({ session, doc, trail: trail.slice(), problems, before, source: ed.source }); break; }
  }
}

test('600 sessions of structural commands mixed with typing hold every invariant', () => {
  const report = failures.slice(0, 4).map((f) => [
    `session ${f.session} on ${JSON.stringify(f.doc)}`,
    `  ${f.trail.join(' → ')}`,
    `  before: ${JSON.stringify(f.before)}`,
    `  after:  ${JSON.stringify(f.source)}`,
    `  ${f.problems.join('; ')}`,
  ].join('\n')).join('\n\n');
  assert.equal(failures.length, 0, `${failures.length} of ${ops} operations broke an invariant\n\n${report}`);
});
