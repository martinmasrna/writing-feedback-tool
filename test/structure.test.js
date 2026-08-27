import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toggleBullet, indentListItem, outdentListItem, setHeadingLevel, toggleEmphasis,
} from '../src/structure.js';
import { transform, parse, regionAt } from '../src/criticmarkup.js';
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

test('Tab nests the current list item as a tracked indentation', () => {
  const text = '- item\n- sibling\n';
  const r = indentListItem(text, at(3));
  assert.equal(r.text, '{++  ++}- item\n- sibling\n');
  assert.equal(transform(r.text, 'accepted'), '  - item\n- sibling\n');
  assert.equal(transform(r.text, 'rejected'), text);
  assert.equal(parseBlocks(r.text)[0].depth, 1);
});

test('Shift+Tab removes one indentation level as a tracked deletion', () => {
  const text = '    - nested\n- sibling\n';
  const r = outdentListItem(text, at(7));
  assert.equal(r.text, '{--  --}  - nested\n- sibling\n');
  assert.equal(transform(r.text, 'accepted'), '  - nested\n- sibling\n');
  assert.equal(transform(r.text, 'rejected'), text);
  assert.equal(parseBlocks(r.text)[0].depth, 2,
    'the old indentation remains visible until the deletion is accepted');
});

test('Tab extends a newly inserted bullet marker instead of nesting markup', () => {
  const added = toggleBullet('item\n', at(3));
  const r = indentListItem(added.text, at(added.caret.start));
  assert.equal(r.text, '{++  - ++}item\n');
  assert.equal(transform(r.text, 'accepted'), '  - item\n');
  assert.equal(transform(r.text, 'rejected'), 'item\n');
});

test('Tab extends a bullet created by Enter without losing its line break', () => {
  const text = '- one\n{++\n- ++}two\n';
  const r = indentListItem(text, at(11));
  assert.equal(r.text, '- one\n{++\n  - ++}two\n');
  assert.equal(transform(r.text, 'accepted'), '- one\n\n  - two\n');
  assert.equal(transform(r.text, 'rejected'), '- one\ntwo\n');
});

test('Tab indents a list item whose insertion holds more than just its marker', () => {
  // Splitting a fresh `{++new bullet++}` with Enter writes the second marker
  // into the same still-open insertion, trailing content included:
  // `{++new \n- bullet++}`. That no longer matches "the insertion is nothing
  // but the marker", so the case above does not fire — Tab has to recognise
  // the indentation point is still inside an open insertion by itself.
  const text = '- {++new \n- bullet++}\n';
  const r = indentListItem(text, at(text.indexOf('bullet') - 2));
  assert.equal(r.text, '- {++new \n  - bullet++}\n');
  assert.equal(transform(r.text, 'accepted'), '- new \n  - bullet\n');
  assert.equal(transform(r.text, 'rejected'), '- \n');
});

test('Shift+Tab outdents it back, shrinking the same insertion in reverse', () => {
  const indented = '- {++new \n  - bullet++}\n';
  const r = outdentListItem(indented, at(indented.indexOf('bullet') - 2));
  assert.equal(r.text, '- {++new \n- bullet++}\n');
  assert.equal(transform(r.text, 'accepted'), '- new \n- bullet\n');
  assert.equal(transform(r.text, 'rejected'), '- \n');
});

test('repeated Tab presses keep extending the same indentation edit', () => {
  const first = indentListItem('- item\n', at(3));
  const second = indentListItem(first.text, at(first.caret.start));
  assert.equal(second.text, '{++    ++}- item\n');
  assert.equal(transform(second.text, 'accepted'), '    - item\n');
  assert.equal(transform(second.text, 'rejected'), '- item\n');
});

test('structural edits refuse to touch code blocks', () => {
  const text = '```\ncode();\n```\n';
  assert.deepEqual(toggleBullet(text, at(6)), { blockedReason: 'unsupported' });
});

/* --- headings ------------------------------------------------------------- */

test('changing heading level is one tracked substitution', () => {
  const text = '## Background';
  const r = setHeadingLevel(text, at(5), 3);
  assert.equal(r.text, '{~~## ~>### ~~}Background');
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

/* --- block types are exclusive -------------------------------------------- */

const conversions = [
  ['paragraph to bullet',    'Plain text.\n',  (t) => toggleBullet(t, at(3)),                    '- Plain text.\n'],
  ['paragraph to numbered',  'Plain text.\n',  (t) => toggleBullet(t, at(3), { ordered: true }), '1. Plain text.\n'],
  ['bullet off',             '- Item.\n',      (t) => toggleBullet(t, at(4)),                    'Item.\n'],
  ['bullet to numbered',     '- Item.\n',      (t) => toggleBullet(t, at(4), { ordered: true }), '1. Item.\n'],
  ['numbered to bullet',     '1. Item.\n',     (t) => toggleBullet(t, at(5)),                    '- Item.\n'],
  ['heading to bullet',      '## Title\n',     (t) => toggleBullet(t, at(5)),                    '- Title\n'],
  ['bullet to heading',      '- Item.\n',      (t) => setHeadingLevel(t, at(4), 2),              '## Item.\n'],
  ['heading to heading',     '## Title\n',     (t) => setHeadingLevel(t, at(5), 3),              '### Title\n'],
  ['heading to body text',   '## Title\n',     (t) => setHeadingLevel(t, at(5), 0),              'Title\n'],
  ['blockquote to heading',  '> Quoted.\n',    (t) => setHeadingLevel(t, at(4), 2),              '## Quoted.\n'],
  ['blockquote to bullet',   '> Quoted.\n',    (t) => toggleBullet(t, at(4)),                    '- Quoted.\n'],
];

for (const [name, original, run, expected] of conversions) {
  test(`${name} replaces the marker rather than stacking it`, () => {
    const r = run(original);
    assert.ok(r && r.text, `${name} did nothing`);
    assert.equal(transform(r.text, 'accepted'), expected);
    assert.equal(transform(r.text, 'rejected'), original, 'and still rejects to the original');
  });
}

test('converting twice returns to where it started', () => {
  const first = toggleBullet('Plain text.\n', at(3));
  const second = setHeadingLevel(first.text, at(first.caret.start), 2);
  const third = toggleBullet(second.text, at(second.caret.start));
  assert.equal(transform(third.text, 'accepted'), '- Plain text.\n');
  assert.equal(transform(third.text, 'rejected'), 'Plain text.\n');
  assert.equal(parseBlocks(third.text).filter((b) => b.type === 'listItem').length, 1, 'one marker, not three');
});

test('a marker mid-change is rewritten, never nested', () => {
  const added = toggleBullet('Plain text.\n', at(3));
  const converted = setHeadingLevel(added.text, at(added.caret.start), 2);
  assert.equal(converted.text, '{++## ++}Plain text.\n', 'the insertion is rewritten in place');
  assert.equal(transform(converted.text, 'rejected'), 'Plain text.\n');
});

/* --- found by fuzzing structural commands alongside typing ---------------- */

test('a heading whose text is already struck keeps its delimiters intact', () => {
  // `contentStart` maps past the opening `{--`, so slicing the marker to it
  // took the delimiter along: `{~~# {--~>## ~~}Title--}` is not CriticMarkup,
  // and rejecting it left `{--` sitting in the prose.
  const r = setHeadingLevel('# {--Title--}\n\nBody.\n', at(0), 2);
  assert.equal(r.text, '{~~# ~>## ~~}{--Title--}\n\nBody.\n');
  assert.equal(transform(r.text, 'rejected'), '# Title\n\nBody.\n');
});

test('a bullet is never spliced inside an annotation', () => {
  // The caret sits in an insertion whose body holds the line breaks, so looking
  // back through the raw source for one found a newline *inside* the markup.
  // `{++\n\n{++- ++}++}` does not parse: rejecting it left a stray `++}`.
  const r = toggleBullet('{--Plain--}{++\n\n++} text only.\n', at(16), {});
  assert.equal(r.text, '{--Plain--}{++\n\n++}{++- ++} text only.\n');
  assert.equal(transform(r.text, 'rejected'), 'Plain text only.\n');
});

test('a marker inside a larger change is refused, not rewritten in place', () => {
  // The `- ` here is the head of a longer insertion, so a substitution over it
  // would land inside that annotation and nest.
  assert.deepEqual(setHeadingLevel('{++- item++}\n', at(5), 2), { blockedReason: 'markup' });
});

test('toggling a marker that Enter just wrote keeps the line break', () => {
  // `{++\n- ++}` is a line break *and* a marker. Treating the whole body as the
  // marker and replacing it collapsed two list items onto one line.
  const off = toggleBullet('- one\n{++\n- ++}two\n', at(11), {});
  assert.equal(off.text, '- one\n{++\n++}two\n', 'the break stays, and stays tracked');
  assert.equal(transform(off.text, 'rejected'), '- one\ntwo\n');

  const converted = toggleBullet('- one\n{++\n- ++}two\n', at(11), { ordered: true });
  assert.equal(converted.text, '- one\n{++\n1. ++}two\n');
  assert.equal(transform(converted.text, 'rejected'), '- one\ntwo\n');
});

test('the caret survives having the marker under it replaced', () => {
  // Shifting alone left a caret that was inside the old marker exactly where it
  // was, which after the marker shrank was in the middle of the new markup.
  const r = setHeadingLevel('{++1. ++}Body\n', at(5), 3);
  assert.notEqual(regionAt(parse(r.text), r.caret.start).kind, 'atomic');
});
