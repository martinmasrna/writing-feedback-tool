/**
 * The annotation list and the header counters.
 *
 * These are how a reviewer sees their own work: what they changed, why, and how
 * much is still unexplained. A structural edit is the interesting case, because
 * on its own an annotation reading `- ` means nothing — the sidebar has to say
 * "bullet added" instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom.js';
import { createSidebar } from '../src/ui/sidebar.js';
import { createHeader } from '../src/ui/header.js';
import { editor } from './harness.js';
import { parse } from '../src/criticmarkup.js';

const doc = installDom();
const make = (tag = 'div') => doc.createElement(tag);

function sidebar() {
  const list = make();
  const count = make();
  const render = createSidebar({ list, count }, { onReveal() {}, onRemove() {}, onReason() {} });
  return {
    list,
    count,
    show(source) {
      render({ anns: parse(source), loaded: true, name: 'doc.md', view: 'rendered', undo: [], redo: [] });
      return list;
    },
  };
}

function header() {
  const views = make();
  for (const v of ['rendered', 'source', 'accepted', 'rejected']) {
    const b = make('button');
    b.dataset.view = v;
    views.append(b);
  }
  const refs = {
    counts: make(), dirtyDot: make(), fileName: make(), undo: make('button'), redo: make('button'),
    save: make('button'), copy: make('button'), views, note: make(), pending: make(),
  };
  const render = createHeader(refs, { onView() {}, onReviewReasons() {} });
  return {
    refs,
    show(source, extra = {}) {
      render({ anns: parse(source), loaded: true, name: 'doc.md', view: 'rendered', undo: [], redo: [], ...extra }, false);
      return refs;
    },
  };
}

/* --- structural edits are described, not quoted ---------------------------- */

const descriptions = [
  ['{++- ++}Item', 'bullet added'],
  ['{--- --}Item', 'bullet removed'],
  ['{++1. ++}Item', 'numbered item added'],
  ['{++## ++}Title', 'heading level 2 added'],
  ['{--## --}Title', 'heading level 2 removed'],
  ['{~~- ~>## ~~}Item', 'bullet → heading level 2'],
  ['{~~## ~>- ~~}Title', 'heading level 2 → bullet'],
  ['{~~## ~>### ~~}Title', 'heading level 2 → heading level 3'],
  ['{~~- ~>1. ~~}Item', 'bullet → numbered item'],
  // What Enter in a list writes: a line break *and* a marker.
  ['{++\n- ++}Item', 'bullet added'],
  ['{~~\n- ~>\n1. ~~}Item', 'bullet → numbered item'],
];

for (const [source, expected] of descriptions) {
  test(`the sidebar reads ${JSON.stringify(source)} as ${JSON.stringify(expected)}`, () => {
    assert.equal(sidebar().show(source).querySelector('.ex').textContent, expected);
  });
}

test('an ordinary edit is quoted rather than described', () => {
  const s = sidebar();
  assert.equal(s.show('{--ordinary text--}').querySelector('.ex').textContent, 'ordinary text');
  assert.equal(s.show('{~~old~>new~~}').querySelector('.ex').textContent, 'old→new');
});

/* --- the list itself -------------------------------------------------------- */

test('one item per annotation, each with a kind and a reason line', () => {
  const source = 'A {--cut--}{>>redundant<<} and an {++add++} and a {~~old~>new~~}.\n';
  const list = sidebar().show(source);
  assert.equal(list.querySelectorAll('.item').length, 3);
  for (const item of list.querySelectorAll('.item')) {
    assert.ok(item.querySelector('.kind'), 'says what kind of edit it is');
    assert.ok(item.querySelector('.why'), 'and offers somewhere for the reason');
  }
  assert.equal(list.querySelector('.why').textContent, 'redundant');
  assert.ok(list.querySelectorAll('.why.none').length, 'the unexplained ones say so');
});

test('an empty document says how to start', () => {
  const s = sidebar();
  assert.match(s.show('# Just a title\n').textContent, /No annotations yet/);
  assert.equal(s.count.textContent, '');
});

/* --- the header ------------------------------------------------------------- */

test('the header counts each kind, and how many still need a reason', () => {
  const h = header();
  const refs = h.show('A {--cut--}{>>why<<} and an {++add++} and a {~~old~>new~~} and a {>>note<<}.\n');
  const counts = [...refs.counts.querySelectorAll('.cnt')].map((n) => n.textContent);
  assert.deepEqual(counts, ['+ 1', '− 1', '⇄ 1', '▣ 1'], 'one of each kind');
  assert.equal(refs.pending.textContent, '2 without reason', 'the insertion and the substitution');
});

test('nothing left to explain says nothing at all', () => {
  const refs = header().show('A {--cut--}{>>because<<} here.\n');
  assert.equal(refs.pending.textContent, '');
});

/* --- and over documents the editor actually produces ------------------------ */

test('the sidebar renders whatever an editing session leaves behind', () => {
  const s = sidebar();
  const ed = editor('## Heading\n\n- one\n- two\n\nTrailing paragraph.\n');
  const steps = [
    () => ed.select('Heading').type('Summary'),
    () => ed.select('two').press('Backspace'),
    () => ed.caretAfter('one').type(' and a half'),
    () => ed.select('Trailing').press('Alt+Delete'),
    () => ed.caretAtEnd().press('Enter'),
  ];
  for (const step of steps) {
    step();
    const list = s.show(ed.source);
    assert.equal(list.querySelectorAll('.item').length, parse(ed.source).length);
  }
});
