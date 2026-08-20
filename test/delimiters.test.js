/**
 * Documents that already contain CriticMarkup delimiters.
 *
 * The tool's one promise is that rejecting every annotation gives back exactly
 * the file that was opened. A document holding a delimiter that is not part of
 * an annotation can break that in two directions, and both are silent:
 *
 *   - a stray `--}` inside text being struck out ends the deletion early, so
 *     the rest of the selection is left as prose and never comes back;
 *   - a stray `{--` anywhere earlier swallows the closing delimiter of the
 *     next annotation made after it, however far away.
 *
 * Neither is worth enumerating case by case. Every operation preserves the
 * underlying document by construction, so the funnel every result passes
 * through asks whether this one did, and refuses if not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editor } from './harness.js';
import { createStore } from '../src/state.js';
import { applyAction } from '../src/editor.js';
import { preservesOriginal } from '../src/edits.js';
import { annotate } from '../src/editor.js';
import { transform } from '../src/criticmarkup.js';

test('a stray closing delimiter inside a deletion is refused', () => {
  const doc = 'Some --} text here.\n';
  const ed = editor(doc).selectRange(0, doc.length - 1).press('Backspace');
  assert.equal(ed.source, doc, 'nothing happened, rather than something wrong');
  assert.equal(ed.rejected, ed.original);
});

test('but the same text can still be replaced, which uses different delimiters', () => {
  const doc = 'Some --} text here.\n';
  const ed = editor(doc).selectRange(0, doc.length - 1).type('X');
  assert.equal(ed.accepted, 'X\n');
  assert.equal(ed.rejected, doc, 'and it still comes back');
});

test('a stray ~> refuses the replacement instead', () => {
  const doc = 'A ~> B here.\n';
  const typed = editor(doc).selectRange(0, doc.length - 1).type('X');
  assert.equal(typed.source, doc, 'a substitution would end at the stray ~>');
  const struck = editor(doc).selectRange(0, doc.length - 1).press('Backspace');
  assert.equal(struck.accepted, '\n', 'a deletion is fine — `--}` is what would end one');
  assert.equal(struck.rejected, doc);
});

test('a stray opening delimiter cannot swallow a later annotation', () => {
  // `{--` earlier in the file would pair with the `--}` of anything made after
  // it, however far away, taking everything between into the deletion.
  const doc = 'A {-- stray opener.\n\nA paragraph well below it.\n';
  const ed = editor(doc).select('paragraph').press('Backspace');
  assert.equal(ed.rejected, ed.original, 'the document underneath is unchanged either way');
  assert.equal(ed.source, doc, 'and the edit was refused rather than made badly');
});

test('an ordinary document is entirely unaffected', () => {
  const ed = editor('Alpha beta gamma.\n').select('beta').press('Backspace');
  assert.equal(ed.source, 'Alpha {--beta--} gamma.\n');
});

test('preservesOriginal is what the check asks', () => {
  assert.equal(preservesOriginal('a b c\n', 'a {--b--} c\n'), true);
  assert.equal(preservesOriginal('a b c\n', 'a c\n'), false, 'text vanished from underneath');
  assert.equal(preservesOriginal('Some --} text\n', '{--Some --} text--}\n'), false,
    'the deletion ends at the stray delimiter, stranding the rest');
});

test('the edit engine refuses before it writes markup it cannot read back', () => {
  const doc = 'Some --} text here.\n';
  const result = applyAction({ text: doc, caret: { start: 0, end: doc.length - 1 }, view: 'rendered' },
    { type: 'deleteBackward' });
  assert.deepEqual(result, { blocked: { kind: 'delimiter' } });
});

test('and the store is the backstop for what that cannot see', () => {
  // A stray opener earlier in the file makes perfectly good markup go wrong
  // *after* it is spliced in, which nothing local to the edit can tell.
  const doc = 'A {-- stray opener.\n\nA paragraph well below it.\n';
  const store = createStore();
  store.load(doc, 'doc.md', null);
  const at = doc.indexOf('paragraph');
  store.setCaret({ start: at, end: at + 'paragraph'.length });
  const result = applyAction({ text: doc, caret: store.state.caret, view: 'rendered' }, { type: 'deleteBackward' });
  assert.ok(result.text, 'the edit engine saw nothing wrong with it');
  assert.equal(store.apply(result), 'unsafe');
  assert.equal(store.state.text, doc, 'the document is untouched');
  assert.equal(store.state.undo.length, 0, 'and nothing went onto the undo stack');
});

test('an empty annotation is never written', () => {
  // Highlighting text that opens with a closing delimiter used to produce
  // `{====}` — an empty highlight, a stray delimiter and an orphaned comment —
  // while leaving the text itself intact, so the store's check saw nothing.
  const r = annotate('# T\n\n==}\n', { start: 5, end: 8 }, 'hl', '', 'why');
  assert.deepEqual(r, { blocked: { kind: 'delimiter' } });
});

/* --- over documents built to be hostile ------------------------------------ */

const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const DOCS = [
  'Alpha --} beta ++} gamma.\n',
  'One ~~} two ~> three ==} four.\n',
  'A {-- b {++ c {~~ d {== e {>> f.\n',
  '# T\n\n--}\n\n~>\n\n==}\n',
  'Normal text with {--a real deletion--} and --} a stray one.\n',
];
const KEYS = ['Backspace', 'Delete', 'Enter', 'Alt+Backspace', 'Alt+Delete', 'Cmd+Backspace'];
const WORDS = ['a', 'x', 'the ', '\n', '-', '}', '~'];

const broken = [];
for (let session = 0; session < 400; session++) {
  const rnd = mulberry32(session * 7919 + 101);
  const doc = DOCS[Math.floor(rnd() * DOCS.length)];
  const ed = editor(doc);

  for (let step = 0; step < 14; step++) {
    try {
      const roll = rnd();
      if (roll < 0.35) ed.type(WORDS[Math.floor(rnd() * WORDS.length)]);
      else if (roll < 0.7) ed.press(KEYS[Math.floor(rnd() * KEYS.length)]);
      else {
        const words = ed.accepted.split(/\s+/).filter((w) => w.length > 1);
        if (words.length) ed.select(words[Math.floor(rnd() * words.length)]);
      }
    } catch { continue; }
    if (ed.rejected !== ed.original) { broken.push({ session, doc, source: ed.source, got: ed.rejected }); break; }
  }
}

test('400 sessions on documents full of stray delimiters keep the original recoverable', () => {
  const report = broken.slice(0, 3)
    .map((f) => `session ${f.session} on ${JSON.stringify(f.doc)}\n  became ${JSON.stringify(f.source)}\n  reverts to ${JSON.stringify(f.got)}`)
    .join('\n\n');
  assert.equal(broken.length, 0, `${broken.length} sessions lost the document underneath\n\n${report}`);
});
