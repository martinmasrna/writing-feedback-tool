import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleBullet, setHeadingLevel, toggleEmphasis } from '../src/structure.js';
import { transform } from '../src/criticmarkup.js';
import { parseBlocks } from '../src/blocks.js';

const at = (p) => ({ start: p, end: p });

/* --- bullets -------------------------------------------------------------- */

test('adding a bullet to a paragraph is a tracked insertion', () => {
  const text = 'Polls an S3 prefix.';
  const r = toggleBullet(text, at(5));
  assert.equal(r.text, '{++- ++}Polls an S3 prefix.');
  assert.equal(transform(r.text, 'accepted'), '- Polls an S3 prefix.');
  assert.equal(transform(r.text, 'rejected'), text, 'rejecting restores the paragraph');
});

test('the new bullet already reads as a list item', () => {
  const r = toggleBullet('Some text', at(2));
  const [block] = parseBlocks(r.text);
  assert.equal(block.type, 'listItem');
});

test('the caret follows the text it was sitting in', () => {
  const text = 'Polls an S3 prefix.';
  const r = toggleBullet(text, at(6));
  assert.equal(r.text.charAt(r.caret.start), text.charAt(6));
});

test('removing a bullet is a tracked deletion', () => {
  const text = '- Polls an S3 prefix.';
  const r = toggleBullet(text, at(5));
  assert.equal(r.text, '{--- --}Polls an S3 prefix.');
  assert.equal(transform(r.text, 'accepted'), 'Polls an S3 prefix.');
  assert.equal(transform(r.text, 'rejected'), text);
});

test('a bullet being removed still reads as a list item until accepted', () => {
  const r = toggleBullet('- item', at(3));
  assert.equal(parseBlocks(r.text)[0].type, 'listItem');
});

test('undoing a bullet you just added removes the insertion, it does not nest', () => {
  const added = toggleBullet('Some text', at(2));
  const undone = toggleBullet(added.text, at(added.caret.start));
  assert.equal(undone.text, 'Some text');
});

test('undoing a bullet you just removed restores the marker cleanly', () => {
  const removed = toggleBullet('- item', at(4));
  const restored = toggleBullet(removed.text, at(removed.caret.start));
  assert.equal(restored.text, '- item');
});

test('numbered lists work the same way', () => {
  const r = toggleBullet('Step one.', at(2), { ordered: true });
  assert.equal(r.text, '{++1. ++}Step one.');
  assert.equal(parseBlocks(r.text)[0].ordered, true);
});

test('bullets operate on the caret line, not the whole paragraph', () => {
  const text = 'first line\nsecond line\n';
  const r = toggleBullet(text, at(text.indexOf('second') + 2));
  assert.equal(r.text, 'first line\n{++- ++}second line\n');
});

test('structural edits refuse to touch code blocks', () => {
  const text = '```\ncode();\n```\n';
  assert.deepEqual(toggleBullet(text, at(6)), { blockedReason: 'unsupported' });
});

/* --- headings ------------------------------------------------------------- */

test('changing heading level is one tracked substitution', () => {
  const text = '## Background';
  const r = setHeadingLevel(text, at(5), 3);
  assert.equal(r.text, '{~~##~>###~~} Background');
  assert.equal(transform(r.text, 'accepted'), '### Background');
  assert.equal(transform(r.text, 'rejected'), text);
});

test('a heading mid-change still reads as a heading', () => {
  const r = setHeadingLevel('## Background', at(5), 3);
  assert.equal(parseBlocks(r.text)[0].type, 'heading');
});

test('demoting a heading to a paragraph strikes the marker', () => {
  const text = '## Background';
  const r = setHeadingLevel(text, at(5), 0);
  assert.equal(r.text, '{--## --}Background');
  assert.equal(transform(r.text, 'accepted'), 'Background');
  assert.equal(transform(r.text, 'rejected'), text);
});

test('promoting a paragraph to a heading', () => {
  const r = setHeadingLevel('Background', at(3), 2);
  assert.equal(r.text, '{++## ++}Background');
  assert.equal(transform(r.text, 'accepted'), '## Background');
});

test('setting the level it already has does nothing', () => {
  assert.equal(setHeadingLevel('## Background', at(5), 2), null);
});

/* --- emphasis ------------------------------------------------------------- */

test('bolding a selection is one tracked substitution', () => {
  const text = 'the loader is a stopgap';
  const sel = { start: 16, end: 23 };
  const r = toggleEmphasis(text, sel, 'strong');
  assert.equal(r.text, 'the loader is a {~~stopgap~>**stopgap**~~}');
  assert.equal(transform(r.text, 'accepted'), 'the loader is a **stopgap**');
  assert.equal(transform(r.text, 'rejected'), text);
});

test('italic uses single markers', () => {
  const r = toggleEmphasis('a word here', { start: 2, end: 6 }, 'em');
  assert.equal(transform(r.text, 'accepted'), 'a *word* here');
});

test('unbolding a selection that includes the markers', () => {
  const text = 'a **word** here';
  const r = toggleEmphasis(text, { start: 2, end: 10 }, 'strong');
  assert.equal(transform(r.text, 'accepted'), 'a word here');
});

test('unbolding a selection sitting inside the markers', () => {
  const text = 'a **word** here';
  const r = toggleEmphasis(text, { start: 4, end: 8 }, 'strong');
  assert.equal(transform(r.text, 'accepted'), 'a word here');
});

test('emphasis refuses to straddle an existing annotation', () => {
  const text = 'a {--gone--} b';
  const r = toggleEmphasis(text, { start: 0, end: 6 }, 'strong');
  assert.deepEqual(r, { blockedReason: 'markup' });
});

/* --- the whole point ------------------------------------------------------ */

test('a document restructured this way still rejects back to the original', () => {
  const original = 'Setup steps\n\nInstall the CLI.\nRun the migration.\n';
  let text = original;
  text = setHeadingLevel(text, at(2), 2).text;
  text = toggleBullet(text, at(text.indexOf('Install') + 2)).text;
  text = toggleBullet(text, at(text.indexOf('Run the') + 2)).text;
  assert.equal(transform(text, 'rejected'), original);
  assert.equal(transform(text, 'accepted'), '## Setup steps\n\n- Install the CLI.\n- Run the migration.\n');
});
