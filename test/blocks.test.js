import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks, splitLines, blockAt, fullySupported, SUPPORTED } from '../src/blocks.js';
import { transform as transformFor } from '../src/criticmarkup.js';

const kinds = (text) => parseBlocks(text).map((b) => b.type);

test('lines carry absolute source offsets', () => {
  const text = 'ab\ncde\n';
  const lines = splitLines(text);
  assert.deepEqual(lines.map((l) => [l.start, l.end, l.text]), [[0, 2, 'ab'], [3, 6, 'cde']]);
});

test('an empty document is one blank line', () => {
  assert.deepEqual(splitLines('').map((l) => l.text), ['']);
});

test('classifies the supported constructs', () => {
  const doc = ['# Title', '', 'Para one', 'still para one', '', '- bullet', '1. ordered', '> quote', '', '---'].join('\n');
  assert.deepEqual(kinds(doc), [
    'heading', 'blank', 'paragraph', 'blank', 'listItem', 'listItem', 'blockquote', 'blank', 'rule',
  ]);
});

test('consecutive paragraph lines join into one block', () => {
  const blocks = parseBlocks('one\ntwo\nthree\n');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].lines, 3);
  assert.equal(blocks[0].end, 13);
});

test('heading records its level and where the content starts', () => {
  const [h] = parseBlocks('### Deep heading');
  assert.equal(h.type, 'heading');
  assert.equal(h.level, 3);
  assert.equal('### Deep heading'.slice(h.contentStart), 'Deep heading');
});

test('list items record marker, depth and content start', () => {
  const blocks = parseBlocks('- top\n  - nested\n1. first\n');
  assert.deepEqual(blocks.map((b) => b.depth), [0, 1, 0]);
  assert.deepEqual(blocks.map((b) => b.ordered), [false, false, true]);
  const src = '- top\n  - nested\n1. first\n';
  assert.equal(src.slice(blocks[0].contentStart, blocks[0].contentEnd), 'top');
  assert.equal(src.slice(blocks[1].contentStart, blocks[1].contentEnd), 'nested');
  assert.equal(src.slice(blocks[2].contentStart, blocks[2].contentEnd), 'first');
});

test('a code fence is unsupported and closes properly', () => {
  const doc = ['para', '```js', 'code();', '```', 'after'].join('\n');
  assert.deepEqual(kinds(doc), ['paragraph', 'unsupported', 'paragraph']);
  const blocks = parseBlocks(doc);
  assert.equal(blocks[1].reason, 'code');
  assert.equal(doc.slice(blocks[2].start, blocks[2].end), 'after', 'content after the fence stays editable');
});

test('a table is swallowed whole as one unsupported block', () => {
  const doc = ['before', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', 'after'].join('\n');
  const blocks = parseBlocks(doc);
  const table = blocks.find((b) => b.reason === 'table');
  assert.ok(table);
  assert.equal(doc.slice(table.start, table.end).split('\n').length, 3);
  assert.equal(kinds(doc).filter((k) => k === 'paragraph').length, 2, 'text either side stays editable');
});

test('markdown inside a code fence is not mistaken for structure', () => {
  const doc = ['```', '# not a heading', '- not a bullet', '```'].join('\n');
  assert.deepEqual(kinds(doc), ['unsupported']);
});

/* --- the point of parsing structure ourselves ---------------------------- */

test('a bullet being inserted still reads as a bullet', () => {
  const [b] = parseBlocks('{++- ++}Some text');
  assert.equal(b.type, 'listItem');
  assert.equal('{++- ++}Some text'.slice(b.contentStart), 'Some text');
});

test('a bullet being deleted still reads as a bullet', () => {
  const [b] = parseBlocks('{--- --}Some text');
  assert.equal(b.type, 'listItem');
  assert.equal('{--- --}Some text'.slice(b.contentStart), 'Some text');
});

test('a heading whose level is being changed still reads as a heading', () => {
  const [h] = parseBlocks('{~~##~>###~~} Title');
  assert.equal(h.type, 'heading');
  assert.equal(h.level, 3, 'at the level it is becoming, not both halves at once');
});

test('a change spanning a line break still yields two blocks', () => {
  const blocks = parseBlocks('- one{++\n- ++}two');
  assert.deepEqual(blocks.map((b) => b.type), ['listItem', 'listItem']);
});

test('block offsets come back in source coordinates', () => {
  const src = '{++- ++}Some text';
  const [b] = parseBlocks(src);
  assert.equal(src.slice(b.contentStart), 'Some text');
});

test('a reason comment does not disturb classification', () => {
  const [b] = parseBlocks('- item{>>why<<}');
  assert.equal(b.type, 'listItem');
});

/* --- helpers -------------------------------------------------------------- */

test('blockAt finds the block containing an offset', () => {
  const doc = '# Title\n\nA paragraph.\n';
  const blocks = parseBlocks(doc);
  assert.equal(blockAt(blocks, 2).type, 'heading');
  assert.equal(blockAt(blocks, doc.indexOf('paragraph')).type, 'paragraph');
});

test('fullySupported flags documents the rendered view cannot fully edit', () => {
  assert.equal(fullySupported(parseBlocks('# Fine\n\n- yes\n')), true);
  assert.equal(fullySupported(parseBlocks('# Fine\n\n```\ncode\n```\n')), false);
});

test('every supported type is one the rendered view claims to handle', () => {
  const types = new Set(kinds('# h\n\npara\n\n- b\n\n> q\n\n---\n'));
  for (const t of types) assert.ok(SUPPORTED.has(t), `${t} should be supported`);
});

/* --- deleting a block break joins the blocks ------------------------------ */

test('a deleted line break stops separating blocks', () => {
  const joined = parseBlocks('## Title{--\n\n--}Body text');
  assert.deepEqual(joined.map((b) => b.type), ['heading'], 'the paragraph joins the heading');
});

test('an intact line break still separates them', () => {
  const apart = parseBlocks('## Title\n\nBody text');
  assert.deepEqual(apart.map((b) => b.type), ['heading', 'blank', 'paragraph']);
});

test('only deleted breaks are ignored, not inserted ones', () => {
  const split = parseBlocks('one{++\n\n++}two');
  assert.equal(split.length > 1, true, 'an inserted break does separate');
});

test('joining survives a round trip through accept and reject', () => {
  const text = '## Title{--\n\n--}Body text';
  assert.equal(transformFor(text, 'accepted'), '## TitleBody text');
  assert.equal(transformFor(text, 'rejected'), '## Title\n\nBody text');
});

test('a heading mid-level-change reads at the level it is becoming', () => {
  assert.equal(parseBlocks('{~~##~>#~~} Title')[0].level, 1, 'not 3, which is both halves at once');
  assert.equal(parseBlocks('{~~#~>####~~} Title')[0].level, 4);
  assert.equal(parseBlocks('{--### --}Title')[0].type, 'heading', 'a removed marker still reads as one');
});
