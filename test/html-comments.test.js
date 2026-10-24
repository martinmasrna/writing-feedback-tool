/**
 * HTML comments: invisible in the rendered view, as in every other renderer.
 *
 * A block of nothing but `<!-- … -->` is still an island — same range, same
 * guards, edited in the Source view — it is just drawn as nothing. Real HTML
 * keeps its box, and so does a comment block with a tracked change in it,
 * because a change must be visible.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screenText, installDom, domSession, buildSource } from './dom.js';
import { editor } from './harness.js';
import { parseBlocks } from '../src/blocks.js';
import { parse } from '../src/criticmarkup.js';

installDom();

const lines = (...l) => l.join('\n');

test('a comment-only block is drawn as nothing', () => {
  const r = render(lines('Before.', '', '<!-- generated -->', '', 'After.', ''));
  assert.equal(r.host.querySelector('pre.island'), null);
  assert.equal(screenText(r.host), 'Before.After.');
});

test('several comments in one block are still nothing', () => {
  const r = render(lines('<!-- one -->', '<!-- two --> <!-- three -->', '', 'After.', ''));
  assert.equal(r.host.querySelector('pre.island'), null);
  assert.equal(screenText(r.host), 'After.');
});

test('a block with real HTML keeps its box', () => {
  for (const html of ['<div>hi</div>', '<img src="a.png">', '<!-- note --> <br>']) {
    const r = render(lines('Before.', '', html, '', 'After.', ''));
    assert.ok(r.host.querySelector('pre.island-html'), html);
  }
});

test('a comment with a tracked change in it is drawn, so the change is seen', () => {
  const doc = lines('Before.', '', '<!-- generated -->', '', 'After.', '');
  const ed = editor(doc, { view: 'source' }).select('generated').type('made');
  const r = render(ed.source);
  assert.ok(r.host.querySelector('pre.island-html .r-ins'));
});

test('the Source view still shows the comment exactly', () => {
  const doc = lines('Before.', '', '<!-- generated -->', '', 'After.', '');
  assert.equal(screenText(buildSource(doc).host), doc);
});

/* --- the file is untouched ------------------------------------------------ */

const HERDS = lines(
  'The cards.', '',
  '<!-- cards:begin family=Hoofed (generated from cards.json) -->', '',
  '| Card | Str |',
  '|---|---:|',
  '| **Boar** | 4 |', '',
  '<!-- cards:end -->', '',
  'After the table.', '');

test('the herds shape: comment, table, comment draws only the table', () => {
  const r = render(HERDS);
  assert.equal(r.host.querySelectorAll('pre.island').length, 0);
  assert.equal(r.host.querySelectorAll('.table-island table').length, 1);
  assert.equal(screenText(r.host), 'The cards.CardStrBoar4After the table.');
  assert.deepEqual(parseBlocks(HERDS).filter((b) => b.type === 'unsupported').map((b) => b.reason),
    ['html', 'table', 'html'], 'the comments are still islands');
});

test('a document with hidden comments comes back byte-identical', () => {
  assert.equal(domSession(HERDS).source, HERDS);
});

test('annotations either side of a hidden comment keep their offsets', () => {
  const s = domSession(HERDS).select('cards').type('animals');
  s.caretAfter('After the table').type('!');
  assert.equal(s.ed.rejected, HERDS);
  const expected = HERDS.replace('The cards.', 'The {~~cards~>animals~~}.')
    .replace('After the table.', 'After the table{++!++}.');
  assert.equal(s.source, expected);
  const anns = parse(s.source);
  assert.deepEqual(anns.map((a) => s.source.slice(a.start, a.end)), ['{~~cards~>animals~~}', '{++!++}']);
});

test('typing inside a hidden comment is still refused', () => {
  const ed = editor(HERDS).caretAt(HERDS.indexOf('cards:end') + 2).type('Y');
  assert.equal(ed.source, HERDS);
});
