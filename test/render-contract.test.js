import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toVisible } from '../src/visible.js';
import { parseVisibleBlocks } from '../src/blocks.js';
import { parse } from '../src/criticmarkup.js';
import { editor } from './harness.js';

/**
 * The rendered view can only put the caret where it has drawn something. Four
 * bugs came from an edit landing on an offset with nothing on screen behind it:
 * the caret silently relocated, and the keystroke looked dead.
 *
 * The renderer walks blocks and emits a mapping per text node. These tests
 * mirror that walk to check that every position an edit can leave the caret in
 * is a position the renderer will have drawn — without needing a browser.
 */

/** Source offsets the rendered view draws, derived the way the renderer does. */
function addressable(text) {
  const visible = toVisible(text);
  const blocks = parseVisibleBlocks(visible.text, visible.spans);
  const ranges = [];
  let blankRun = 0;
  for (const block of blocks) {
    if (block.type === 'blank') {
      blankRun++;
      if (blankRun > 1) ranges.push([block.start, block.start]);
      continue;
    }
    blankRun = 0;
    if (block.type === 'rule') continue;
    ranges.push([block.contentStart, block.contentEnd]);
  }
  ranges.push([visible.text.length, visible.text.length]);   // the document tail
  return { visible, ranges };
}

/** Can the caret at this source offset be drawn? */
function isDrawn(text, offset) {
  const { visible, ranges } = addressable(text);
  // Translate the source offset into visible coordinates.
  let vis = null;
  for (let i = 0; i < visible.map.length; i++) {
    if (visible.map[i] === offset) { vis = i; break; }
  }
  if (vis === null) vis = visible.text.length;
  return ranges.some(([from, to]) => vis >= from && vis <= to);
}

const scenarios = [
  ['typing in a paragraph', () => editor('# T\n\nBody text.\n').caretAfter('Body').type(' more')],
  ['deleting a word', () => editor('# T\n\nBody text here.\n').select('text').press('Backspace')],
  ['deleting into a heading', () => editor('## Summary\n\nBody.\n').select('ary').press('Backspace')],
  ['typing back what was deleted', () => editor('## Summary\n\nBody.\n').select('ary').press('Backspace').type('ary')],
  ['partly retyping a deletion', () => editor('## Summary\n\nBody.\n').select('ary').press('Backspace').type('a')],
  ['Enter for space', () => editor('# T\n\nBody.\n').caretBefore('Body').press('Enter', 2)],
  ['joining two blocks', () => editor('# T\n\nBody.\n').caretBefore('Body').press('Backspace')],
  ['replacing a selection', () => editor('# T\n\nsome words\n').select('some').type('other')],
  ['deleting to the start of a line', () => editor('# T\n\nsome words here\n').caretAtEnd().press('Cmd+Backspace')],
];

for (const [name, build] of scenarios) {
  test(`the caret has somewhere to live after ${name}`, () => {
    const ed = build();
    assert.ok(
      isDrawn(ed.source, ed.caret.start),
      `caret at ${ed.caret.start} is not drawn by the rendered view\n  ${JSON.stringify(ed.marked)}`,
    );
  });
}

test('every edit leaves at least one annotation the sidebar can show', () => {
  const ed = editor('# T\n\nBody text.\n').select('text').press('Backspace');
  assert.ok(parse(ed.source).length > 0);
});

test('an edit that changes nothing leaves no annotation at all', () => {
  const ed = editor('# T\n\nBody text.\n').select('text').press('Backspace').type('text');
  assert.equal(parse(ed.source).length, 0);
  assert.equal(ed.source, '# T\n\nBody text.\n');
});
