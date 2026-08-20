/**
 * The Source view.
 *
 * It is an editing surface, not a preview, and it rests on two invariants
 * stated in `dom/render.js` and never checked: every source character is on
 * screen exactly once and in order, so offsets are a plain running sum; and
 * anything that must not be typed into is `contenteditable="false"`.
 *
 * If the first ever slips, what the user sees stops being what is on disk and
 * every offset after the slip is wrong.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSource, screenText, isVirtual } from './dom.js';
import { editor } from './harness.js';
import { parse, regionAt } from '../src/criticmarkup.js';

const DOCS = [
  'Plain text with no markup at all.\n',
  'One{++ inserted++} and {--struck--} and {~~old~>new~~}.\n',
  'An edit {--with--}{>>because it was wrong<<} a reason.\n',
  'A {==highlight==} and a {>>bare comment<<} here.\n',
  '# Title\n\n- {++- ++}nested marker\n\n```\ncode\n```\n',
  'A change {++spanning\n\na line break++} here.\n',
  '{++at the very start++}and at the end{--gone--}',
];

for (const source of DOCS) {
  test(`the source view shows the file exactly — ${JSON.stringify(source.slice(0, 30))}`, () => {
    const s = buildSource(source);
    assert.equal(screenText(s.host), source,
      'what you see is meant to be provably what is on disk');
  });

  test(`every offset the caret can hold round trips — ${JSON.stringify(source.slice(0, 30))}`, () => {
    const s = buildSource(source);
    const anns = parse(source);
    for (let off = 0; off <= source.length; off++) {
      if (regionAt(anns, off).kind === 'atomic') continue;   // the caret never goes there
      const [node, at] = s.index.sourceToPoint(off);
      assert.equal(s.index.pointToSource(node, at), off, `offset ${off}`);
    }
  });
}

test('finished markup cannot be typed into, but an insertion body can', () => {
  const s = buildSource('One{++ added++} and {--struck--}.\n');
  const del = s.host.querySelector('.a-del');
  assert.equal(del.getAttribute('contenteditable'), 'false');
  const ins = s.host.querySelector('.a-ins');
  assert.equal(ins.getAttribute('contenteditable'), null, 'you can still edit what you are inserting');
  for (const d of s.host.querySelectorAll('.syn')) {
    assert.equal(d.getAttribute('contenteditable'), 'false', 'delimiters are shown but never typed into');
  }
});

test('the unexplained-edit marker is chrome, not source text', () => {
  const s = buildSource('One{++ added++} more.\n');
  const flag = s.host.querySelector('.noreason');
  assert.ok(flag);
  assert.equal(isVirtual(flag), true);
});

/* --- editing there is literal --------------------------------------------- */

test('backspace in the source view takes one character, not a whole marker', () => {
  const ed = editor('# Heading\n\nBody.\n', { view: 'source' }).caretBefore('Heading').press('Backspace');
  assert.equal(ed.source, '#{-- --}Heading\n\nBody.\n',
    'the marker is visible text here, so backspace behaves literally');
});

test('backspace at the head of a block takes one newline, not the separator', () => {
  const ed = editor('# T\n\nBody.\n', { view: 'source' }).caretBefore('Body').press('Backspace');
  assert.equal(ed.source, '# T\n{--\n--}Body.\n');
});

test('Enter in the source view inserts one newline', () => {
  const ed = editor('# T\n\nBody.\n', { view: 'source' }).caretAfter('Body').press('Enter');
  assert.equal(ed.source, '# T\n\nBody{++\n++}.\n');
});
