/**
 * Tables: still islands, drawn as tables.
 *
 * A table is edited in the Source view and refused in the rendered one, exactly
 * as before. What changed is only what the reader sees: cells, a header row,
 * column alignment, inline markdown inside cells — instead of the pipes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks, parseTable } from '../src/blocks.js';
import { render, screenText, mappedNodes, installDom, domSession } from './dom.js';
import { editor } from './harness.js';
import { toVisible, toVisibleOffset } from '../src/visible.js';

installDom();

/** The table in a document with no annotations, where visible is source. */
function tableOf(doc) {
  const block = parseBlocks(doc).find((b) => b.reason === 'table');
  assert.ok(block, 'a table block');
  const t = parseTable(doc, block.start, block.end);
  const text = (c) => (c ? doc.slice(c.start, c.end) : null);
  return t && { ...t, block, head: t.head.map(text), rows: t.rows.map((r) => r.map(text)) };
}

const rows = (...lines) => lines.join('\n');

/* --- parsing ------------------------------------------------------------- */

test('header, rows and cells come out trimmed', () => {
  const t = tableOf(rows('| a | b |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |'));
  assert.deepEqual(t.head, ['a', 'b']);
  assert.deepEqual(t.rows, [['1', '2'], ['3', '4']]);
});

test('alignment is read from the delimiter row', () => {
  const t = tableOf(rows('| a | b | c | d |', '|---|:---|:---:|---:|', '| 1 | 2 | 3 | 4 |'));
  assert.deepEqual(t.align, [null, 'left', 'center', 'right']);
});

test('outer pipes are optional', () => {
  const t = tableOf(rows('a | b', '--|--:', '1 | 2'));
  assert.deepEqual(t.head, ['a', 'b']);
  assert.deepEqual(t.rows, [['1', '2']]);
  assert.deepEqual(t.align, [null, 'right']);
});

test('empty cells are cells, and short rows are padded', () => {
  const t = tableOf(rows('| a | b | c |', '|---|---|---|', '| 1 |  | 3 |', '| x |'));
  assert.deepEqual(t.rows, [['1', '', '3'], ['x', null, null]]);
});

test('a row with too many cells is cut to the header', () => {
  const t = tableOf(rows('| a | b |', '|---|---|', '| 1 | 2 | 3 |'));
  assert.deepEqual(t.rows, [['1', '2']]);
});

test('an escaped pipe stays inside its cell, and its backslash is noted', () => {
  const doc = rows('| a | b |', '|---|---|', '| x \\| y | 2 |');
  const t = tableOf(doc);
  assert.deepEqual(t.rows, [['x \\| y', '2']]);
  assert.deepEqual(t.escapes.map((i) => doc.slice(i, i + 2)), ['\\|']);
});

test('inline markup in a cell is kept for the inline parser', () => {
  const t = tableOf(rows('| Card | Text |', '|---|---|', '| **[BOAR]** | `code` and [a](b.md) |'));
  assert.deepEqual(t.rows, [['**[BOAR]**', '`code` and [a](b.md)']]);
});

test('a table followed by text ends at the blank line', () => {
  const doc = rows('| a | b |', '|---|---|', '| 1 | 2 |', '', 'After the table.');
  const t = tableOf(doc);
  assert.equal(doc.slice(t.block.start, t.block.end), rows('| a | b |', '|---|---|', '| 1 | 2 |'));
  assert.deepEqual(parseBlocks(doc).map((b) => b.type), ['unsupported', 'blank', 'paragraph']);
});

test('a table between two HTML comment lines is its own block', () => {
  const doc = rows('<!-- begin -->', '| a | b |', '|---|---|', '| 1 | 2 |', '<!-- end -->', '', 'After.');
  const blocks = parseBlocks(doc);
  assert.deepEqual(blocks.map((b) => b.reason || b.type), ['html', 'table', 'html', 'blank', 'paragraph']);
  const t = tableOf(doc);
  assert.deepEqual(t.head, ['a', 'b']);
  assert.deepEqual(t.rows, [['1', '2']]);
});

test('a block that is not the shape of a table is not guessed at', () => {
  // Two lines above the delimiter: GFM has one header row, so this is drawn raw.
  const doc = rows('| x |', '| a | b |', '|---|---|', '| 1 | 2 |');
  assert.equal(tableOf(doc), null);
  // A header with a different number of cells than the delimiter row.
  assert.equal(tableOf(rows('| a | b | c |', '|---|---|', '| 1 | 2 |')), null);
});

/* --- what reaches the screen --------------------------------------------- */

const DOC = rows(
  'Before.', '',
  '| Card | Rarity | Str | Text |',
  '|---|---|---:|---|',
  '| **[BOAR]** | legendary | 5 | Your `opponent` \\| loses. |',
  '| Deer | common |  | Flee. |',
  '', 'After.', '');

test('a table renders as a table, with its header and alignment', () => {
  const r = render(DOC);
  const table = r.host.querySelector('.table-island table');
  assert.ok(table, 'drawn as a table');
  assert.deepEqual([...table.querySelectorAll('th')].map((th) => th.textContent), ['Card', 'Rarity', 'Str', 'Text']);
  const body = [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent));
  assert.deepEqual(body, [['[BOAR]', 'legendary', '5', 'Your opponent | loses.'], ['Deer', 'common', '', 'Flee.']]);
  assert.equal(table.querySelector('tbody td:nth-child(3)').style.textAlign, 'right');
  assert.equal(table.querySelector('tbody td:nth-child(1)').style.textAlign, '');
  assert.ok(table.querySelector('td strong'), 'bold in a cell');
  assert.ok(table.querySelector('td code'), 'code in a cell');
  assert.equal(r.host.querySelector('pre.island'), null, 'not the raw island');
});

test('the table is read-only, and no pipe of its syntax reaches the screen', () => {
  const r = render(DOC);
  assert.equal(r.host.querySelector('.table-island').getAttribute('contenteditable'), 'false');
  assert.equal(screenText(r.host).includes('|---'), false);
  assert.equal(screenText(r.host).includes('\\|'), false);
});

test('every cell says truthfully where it came from, and is drawn once', () => {
  const doc = rows('| a | b |', '|---|---|', '| {~~old~>new~~} | x \\| y |', '', 'After.');
  const r = render(doc);
  const drawn = [];
  for (const { text, start } of mappedNodes(r)) {
    if (!text) continue;
    const from = toVisibleOffset(r.visible, start);
    assert.equal(r.visible.text.slice(from, from + text.length), text);
    drawn.push([from, from + text.length]);
  }
  for (let i = 1; i < drawn.length; i++) assert.ok(drawn[i][0] >= drawn[i - 1][1]);
  assert.ok(r.host.querySelector('td .r-del'), 'a change inside a cell keeps its styling');
  assert.ok(r.host.querySelector('td .r-ins'));
});

test('a table the parser will not guess at is still drawn raw', () => {
  const r = render(rows('| x |', '| a | b |', '|---|---|', '| 1 | 2 |', ''));
  assert.ok(r.host.querySelector('pre.island-table'));
  assert.equal(r.host.querySelector('table'), null);
});

/* --- the file is untouched ------------------------------------------------ */

test('a document with a table comes back byte-identical when nothing was edited', () => {
  const s = domSession(DOC);
  assert.equal(s.source, DOC);
  assert.equal(toVisible(s.source).spans.length, 0);
});

test('editing around a table leaves the table and every offset intact', () => {
  const s = domSession(DOC).caretAfter('After').type('wards');
  assert.equal(s.source, DOC.replace('After.', 'After{++wards++}.'));
  assert.equal(s.ed.rejected, DOC);
  const before = domSession(DOC).select('Before').type('Above');
  assert.equal(before.source, DOC.replace('Before.', '{~~Before~>Above~~}.'));
});

test('typing inside the table is refused in the rendered view', () => {
  const ed = editor(DOC).caretAt(DOC.indexOf('legendary') + 3).type('Y');
  assert.equal(ed.source, DOC);
});

test('a cell edited in the Source view still renders as a table', () => {
  const ed = editor(DOC, { view: 'source' }).select('common').type('rare');
  assert.equal(ed.rejected, DOC);
  const r = render(ed.source);
  const cells = [...r.host.querySelectorAll('tbody tr:nth-child(2) td')].map((td) => screenText(td));
  assert.deepEqual(cells, ['Deer', 'commonrare', '', 'Flee.']);
});
