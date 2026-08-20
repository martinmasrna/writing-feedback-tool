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
import { createControls } from '../src/ui/controls.js';
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

function controls() {
  const views = make();
  for (const v of ['rendered', 'source']) {
    const b = make('button');
    b.dataset.view = v;
    views.append(b);
  }
  const refs = {
    undo: make('button'), redo: make('button'),
    save: make('button'), copy: make('button'), views,
    side: make('button'), sideClose: make('button'),
  };
  const render = createControls(refs, { onView() {}, onToggleSide() {} });
  return {
    refs,
    show(source, extra = {}) {
      render({ anns: parse(source), loaded: true, name: 'doc.md', view: 'rendered', sideOpen: true, undo: [], redo: [], ...extra },
        extra.dirty === true);
      return refs;
    },
  };
}

/**
 * What the excerpt says, without the sign in front of it. The sign stands in
 * for the DELETE / INSERT header the item used to carry.
 */
function says(list) {
  const ex = list.querySelector('.ex');
  const sign = ex.querySelector('.sign');
  return sign ? ex.textContent.slice(sign.textContent.length) : ex.textContent;
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
    assert.equal(says(sidebar().show(source)), expected);
  });
}

test('an ordinary edit is quoted rather than described', () => {
  const s = sidebar();
  assert.equal(says(s.show('{--ordinary text--}')), 'ordinary text');
  assert.equal(says(s.show('{~~old~>new~~}')), 'old→new');
});

/* --- the list itself -------------------------------------------------------- */

test('one item per annotation, each with an excerpt and a reason line', () => {
  const source = 'A {--cut--}{>>redundant<<} and an {++add++} and a {~~old~>new~~}.\n';
  const list = sidebar().show(source);
  assert.equal(list.querySelectorAll('.item').length, 3);
  for (const item of list.querySelectorAll('.item')) {
    assert.ok(item.querySelector('.ex'), 'shows what was edited');
    assert.ok(item.querySelector('.why'), 'and offers somewhere for the reason');
  }
  assert.equal(list.querySelector('.why').textContent, 'redundant');
  assert.ok(list.querySelectorAll('.why.none').length, 'the unexplained ones say so');
});

test('the excerpt says what kind of edit it is without naming it', () => {
  const s = sidebar();
  const cut = s.show('A {--cut--} here.\n').querySelector('.ex');
  assert.ok(cut.querySelector('.sign-del'), 'a deletion is signed');
  assert.ok(cut.querySelector('del'), 'and struck');

  const add = s.show('A {++add++} here.\n').querySelector('.ex');
  assert.ok(add.querySelector('.sign-ins'));
  assert.ok(add.querySelector('ins'));

  const sub = s.show('A {~~old~>new~~} here.\n').querySelector('.ex');
  assert.equal(sub.querySelector('.sign'), null, 'two colours either side of an arrow need no sign');
  assert.ok(sub.querySelector('del') && sub.querySelector('.arrow') && sub.querySelector('ins'));

  const note = s.show('A {==phrase==}{>>a note<<} here.\n').querySelector('.ex');
  assert.ok(note.querySelector('mark.hl'), 'a comment is drawn as the highlight it is');

  const loose = s.show('A line{>>unanchored<<} of prose.\n').querySelector('.ex');
  assert.equal(loose.textContent, 'unanchored note', 'and one with nothing under it says so');
});

test('an empty document says how to start', () => {
  const s = sidebar();
  assert.match(s.show('# Just a title\n').textContent, /No annotations yet/);
  assert.equal(s.count.textContent, '');
});

/* --- the controls over the document ----------------------------------------- */

// Rendering against exactly these refs is the check that nothing else is left
// in the row: a control still reaching for a file name would throw here.
test('the controls follow the document: which view, and whether it is saved', () => {
  const c = controls();
  const refs = c.show('A {--cut--} here.\n');
  assert.equal(refs.save.classList.contains('dirty'), false);
  assert.equal(refs.save.disabled, false, 'a loaded document can be saved');
  assert.equal([...refs.views.children].find((b) => b.classList.contains('on')).dataset.view, 'rendered');

  c.show('A {--cut--} here.\n', { dirty: true, view: 'source' });
  assert.equal(refs.save.classList.contains('dirty'), true, 'unsaved work is marked on Save');
  assert.equal([...refs.views.children].find((b) => b.classList.contains('on')).dataset.view, 'source');
});

test('a folded panel leaves its count behind, an open one does not', () => {
  const c = controls();
  const source = 'A {--cut--}{>>why<<} and an {++add++} and a {~~old~>new~~}.\n';

  const open = c.show(source);
  assert.equal(open.side.dataset.count, undefined, 'the list is right there saying it');
  assert.equal(open.side.classList.contains('on'), true);

  const shut = c.show(source, { sideOpen: false });
  assert.equal(shut.side.dataset.count, '2', 'the insertion and the substitution');
  assert.equal(shut.side.classList.contains('on'), false);

  assert.equal(c.show('Nothing {--cut--}{>>explained<<} here.\n', { sideOpen: false }).side.dataset.count,
    undefined, 'and nothing owed is nothing to say');
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
