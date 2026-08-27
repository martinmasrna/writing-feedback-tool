/**
 * Wiring. Everything below is orchestration: the editing rules live in
 * edits.js, the markup rules in criticmarkup.js, and the document state in
 * state.js — all three of which are pure and tested.
 */

import { hasReason } from './criticmarkup.js';
import * as edits from './edits.js';
import { createStore } from './state.js';
import { buildDocument } from './dom/render.js';
import { buildRendered } from './dom/render-rendered.js';
import { parseBlocks, blockFor } from './blocks.js';
import * as structure from './structure.js';
import { annotate } from './editor.js';
import { createOffsetIndex } from './dom/offsets.js';
import { createToast } from './ui/toast.js';
import { createControls } from './ui/controls.js';
import { createSidebar } from './ui/sidebar.js';
import { createToolbar } from './ui/toolbar.js';
import { createDialog } from './ui/dialog.js';
import { attachInput, attachShortcuts } from './input.js';
import * as files from './files.js';

const $ = (sel) => document.querySelector(sel);

export function createApp() {
  const doc = $('#doc');
  const pane = $('#docPane');
  const store = createStore();
  const offsets = createOffsetIndex(doc);
  const toast = createToast($('#toast'));

  /** Set while we restore the caret ourselves, so it does not read as a user move. */
  let restoringCaret = false;
  /** The selection the floating toolbar is acting on. */
  let pendingSelection = null;

  /* --- rendering --------------------------------------------------------- */

  const renderControls = createControls({
    undo: $('#btnUndo'), redo: $('#btnRedo'), save: $('#btnSave'), copy: $('#btnCopy'),
    views: $('#views'), side: $('#btnSide'), sideClose: $('#btnSideClose'),
  }, {
    onView: (view) => { toolbar.hide(); store.setView(view); },
    onToggleSide: () => store.toggleSide(),
  });

  const renderSidebar = createSidebar({ list: $('#list'), count: $('#annCount') }, {
    onReveal: reveal,
    onRemove: (a) => {
      store.clearActive();
      applyResult(edits.removeAnnotation(store.state.text, a.start));
    },
    onReason: (a, value) => {
      if (value === null) { store.refresh(); return; }   // cancelled
      const result = edits.setReason(store.state.text, a.start, value, store.state.caret);
      if (result) applyResult(result); else store.refresh();
    },
  });

  const toolbar = createToolbar($('#toolbar'), { onAction: openForm });

  const dialog = createDialog({
    dialog: $('#dialog'), scrim: $('#scrim'), title: $('#dlgTitle'), ctx: $('#dlgCtx'),
    reason: $('#fReason'), reasonLabel: $('#lblReason'), reasonOpt: $('#reasonOpt'),
    text: $('#fText'), textLabel: $('#lblText'), textRow: $('#textRow'),
    apply: $('#dlgApply'), close: $('#dlgClose'),
  }, {
    onAnnotate: (spec, message) => {
      if (!spec) { toast(message); return; }
      store.clearActive();
      const result = annotate(store.state.text, spec.selection, spec.kind, spec.text, spec.reason);
      applyResult(result);
      if (result && !result.blocked && !spec.reason.trim()) toast('Annotation saved without a reason.');
      doc.focus();
    },
    onReason: (annotation, value, returnCaret) => {
      store.clearActive();
      const result = edits.setReason(store.state.text, annotation.start, value, returnCaret);
      doc.focus();
      if (result) applyResult(result);
      else if (returnCaret) { store.setCaret(returnCaret); offsets.writeSelection(returnCaret); }
    },
    onDismiss: (returnCaret) => {
      store.clearActive();
      doc.focus();
      if (returnCaret) { store.setCaret(returnCaret); offsets.writeSelection(returnCaret); }
    },
  });

  function render() {
    const state = store.state;
    doc.classList.toggle('rendered', state.view === 'rendered');
    doc.textContent = '';
    if (state.view === 'rendered') {
      const { fragment, mappings, visible } = buildRendered(state.text);
      doc.append(fragment);
      offsets.reindex(mappings, visible);
    } else {
      doc.append(buildDocument(state.text, state.anns));
      offsets.reindex();
    }

    renderSidebar(state);
    renderControls(state, store.dirty());
    // No document, no annotations to list: the panel is not an empty frame.
    $('main').classList.toggle('side-off', !state.loaded || !state.sideOpen);
    $('#empty').style.display = state.loaded ? 'none' : 'flex';

    if (state.caret && !dialog.open) {
      restoringCaret = true;
      offsets.writeSelection(state.caret);
      setTimeout(() => { restoringCaret = false; }, 0);
    }
  }
  store.subscribe(render);

  /* --- the reason prompt, fired when an edit settles --------------------- */

  function rectOf(annotation) {
    const node = doc.querySelector(`[data-start="${annotation.start}"]`);
    return node ? node.getBoundingClientRect() : null;
  }

  /**
   * Editing is never interrupted to ask for a reason.
   *
   * Reasons are a review-time act, not a typing-time one: you press Enter for
   * room, write, delete half of it, come back ten minutes later. Being asked
   * "why?" five seconds after every keystroke fights that, and re-arms itself
   * on the next cursor move, which is worse. Unexplained edits are marked
   * instead — inline and in the sidebar — and explained when the writing is
   * done.
   */
  function settle() {
    store.clearActive();
    return false;
  }

  /* --- selection --------------------------------------------------------- */

  /**
   * Is this reading just the caret we drew ourselves, come back to us?
   *
   * The rendered view cannot represent every source offset, so writing the
   * caret out and reading it back loses precision the edit engine depends on —
   * and this fires after every render, so the loss compounds. Where the reading
   * means the same place on screen as the caret we already hold, the one we
   * hold is the better of the two and stays.
   */
  function readingIsOurOwn(sel) {
    const caret = store.state.caret;
    if (!caret) return false;
    return offsets.readBack(caret.start) === sel.start && offsets.readBack(caret.end) === sel.end;
  }

  function onSelectionChange() {
    const state = store.state;
    if (dialog.open || !state.loaded) return;
    const sel = offsets.readSelection();
    if (!sel) { pendingSelection = null; toolbar.hide(); return; }
    if (!readingIsOurOwn(sel)) store.setCaret(sel);

    if (state.activeStart !== null && !restoringCaret) {
      const a = store.activeAnnotation();
      if (a && (sel.start < a.start || sel.start > a.end || sel.end > a.end)) settle();
    }

    if (sel.end > sel.start) {
      const rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
      pendingSelection = sel;
      toolbar.show(rect);
    } else {
      pendingSelection = sel;
      toolbar.hide();
    }
  }

  let selectionTimer = null;
  document.addEventListener('selectionchange', () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(onSelectionChange, 10);
  });
  pane.addEventListener('scroll', () => { if (!dialog.open) toolbar.hide(); });

  doc.addEventListener('click', (e) => {
    // Two ways in, and they address their annotation differently: the source
    // view's flag by index, the rendered view's hover pill by source offset.
    // Nothing else in the rendered view is a click target — an insertion is
    // text you are still typing into, and the click that puts the caret there
    // cannot also open a dialog.
    const marker = e.target.closest ? e.target.closest('.noreason, .add-reason') : null;
    if (!marker) return;
    e.preventDefault();
    const a = marker.classList.contains('add-reason')
      ? store.state.anns.find((x) => x.start === Number(marker.dataset.ann))
      : store.state.anns[Number(marker.dataset.ann)];
    if (a) dialog.openReasonPrompt(a, store.state.caret, rectOf(a));
  });

  function openForm(kind) {
    if (!pendingSelection || pendingSelection.end === pendingSelection.start) {
      toast('Select some text first.');
      return;
    }
    const probe = annotate(store.state.text, pendingSelection, kind, '', '');
    if (probe && probe.blocked) { refuse(probe.blocked); return; }
    toolbar.hide();
    const rect = window.getSelection().rangeCount
      ? window.getSelection().getRangeAt(0).getBoundingClientRect()
      : null;
    dialog.openForm(kind, pendingSelection, store.state.text, rect);
  }

  function refuse(blocked) {
    if (blocked.kind === 'delimiter') {
      toast('That text contains a CriticMarkup delimiter, so it cannot be wrapped in an '
        + 'annotation without breaking it. Remove the delimiter first, or select around it.');
      return;
    }
    if (blocked.kind === 'unsupported') {
      const what = blocked.reason === 'code' ? 'a code block' : blocked.reason === 'table' ? 'a table' : 'raw HTML';
      toast(`That selection takes in ${what}, which this view cannot edit safely. `
        + 'Select around it, or switch to the Source view.');
      return;
    }
    toast(`That range crosses an existing ${blocked.type === 'hl' ? 'comment' : blocked.type} annotation. `
      + 'Annotations can’t nest or overlap — delete that one first.');
    const i = store.state.anns.indexOf(blocked);
    if (i >= 0) reveal(i);
  }

  /** Walk to the next annotation still lacking a reason and offer to explain it. */
  function reviewNextReason() {
    const pending = store.state.anns.filter((a) => a.type !== 'com' && !hasReason(a));
    if (!pending.length) { toast('Every annotation has a reason.'); return; }
    const a = pending[0];
    reveal(store.state.anns.indexOf(a));
    dialog.openReasonPrompt(a, store.state.caret, rectOf(a));
  }

  function reveal(index) {
    const a = store.state.anns[index];
    const node = doc.querySelector(`.ann[data-i="${index}"]`)
      || (a && doc.querySelector(`[data-start="${a.start}"]`));
    if (!node) return;
    const r = node.getBoundingClientRect();
    const pr = pane.getBoundingClientRect();
    const top = pane.scrollTop + (r.top - pr.top) - (pane.clientHeight - r.height) / 2;
    pane.scrollTop = Math.max(0, Math.min(top, pane.scrollHeight - pane.clientHeight));
    node.classList.add('flash');
    setTimeout(() => node.classList.remove('flash'), 900);
  }

  /* --- applying edit results -------------------------------------------- */

  function applyResult(result) {
    if (!result) return;
    if (result.blocked) { refuse(result.blocked); return; }
    if (store.apply(result) === 'unsafe') {
      toast('That edit would change the document underneath the annotations, so it was refused. '
        + 'This file contains CriticMarkup delimiters that are not part of an annotation — '
        + 'the Source view will show where.');
    }
  }

  /* --- structural commands ------------------------------------------------ */

  function runStructure(fn) {
    const state = store.state;
    if (!state.loaded || !state.caret) return;
    const result = fn(state.text, state.caret);
    if (!result) return;
    if (result.blockedReason === 'unsupported') {
      toast('That block is a code fence, table or raw HTML — edit it in the Source view.');
      return;
    }
    if (result.blockedReason === 'markup') {
      toast('That would nest one annotation inside another. Resolve the existing one first.');
      return;
    }
    store.clearActive();
    store.apply(result);
    doc.focus();
  }

  const commands = {
    reasons: reviewNextReason,
    bullet: () => runStructure((t, c) => structure.toggleBullet(t, c)),
    numbered: () => runStructure((t, c) => structure.toggleBullet(t, c, { ordered: true })),
    indent: () => runStructure((t, c) => structure.indentListItem(t, c)),
    outdent: () => runStructure((t, c) => structure.outdentListItem(t, c)),
    heading: (level) => runStructure((t, c) => structure.setHeadingLevel(t, c, level)),
    bold: () => runStructure((t, c) => structure.toggleEmphasis(t, pendingSelection || c, 'strong')),
    italic: () => runStructure((t, c) => structure.toggleEmphasis(t, pendingSelection || c, 'em')),
  };

  /* --- input ------------------------------------------------------------- */

  attachInput(doc, {
    read: () => offsets.readSelection(),
    apply: applyResult,
    getText: () => store.state.text,
    getView: () => store.state.view,
    canEdit: () => store.state.loaded,
    undo: () => store.undo(),
    redo: () => store.redo(),
    onComposedRender: render,
    setCaret: (caret) => { store.setCaret(caret); offsets.writeSelection(caret); },
    stepInView: (offset, dir, axis) => axis === 'vertical'
      ? offsets.vertical(dir)
      : offsets.step(offset, dir),
    onTab: (out) => (out ? commands.outdent() : commands.indent()),
  });

  attachShortcuts({
    undo: () => store.undo(),
    redo: () => store.redo(),
    save: () => save(),
    comment: () => {
      if (pendingSelection && pendingSelection.end > pendingSelection.start) openForm('hl');
      else toast('Select the passage you want to comment on first.');
    },
    escape: () => { showHelp(false); toolbar.hide(); },
    dialogOpen: () => dialog.open,
    commands,
  });

  /* --- files ------------------------------------------------------------- */

  const fileInput = $('#fileInput');

  function load(text, name, handle, diskPath) {
    store.load(text, name, handle, diskPath);
    pane.scrollTop = 0;
    pendingSelection = null;
  }

  async function open() {
    if (store.dirty() && !confirm('Open another document? Unsaved annotations will be lost.')) return;
    const opened = await files.openDocument(fileInput);
    if (opened) load(opened.text, opened.name, opened.handle);
  }

  async function save() {
    const state = store.state;
    if (!state.loaded) return;

    let result;
    if (state.diskPath) {
      result = await files.saveToPath(state.text, state.diskPath);
      // The server refused, or isn't there any more — fall back to the
      // picker rather than lose the save entirely.
      if (result.status === 'error') {
        toast(`Could not write ${state.diskPath} (${result.detail}) — falling back to the picker.`);
        result = await files.saveDocument(state.text, state.name, state.handle);
      }
    } else {
      result = await files.saveDocument(state.text, state.name, state.handle);
    }
    if (result.status === 'cancelled') return;
    store.markSaved(result.name, result.handle);
    if (result.status === 'in-place') toast(`Saved to ${result.name}.`);
    else if (result.status === 'linked') toast(`Saved to ${result.name}. Further saves write straight to this file.`);
    else if (result.detail) toast(`Could not write the file in place (${result.detail}) — downloaded instead.`);
    else toast(`Downloaded ${result.name || 'annotated.md'}.`);

    // Never block the save; just do not let unexplained edits ship silently.
    const unexplained = store.state.anns.filter((a) => a.type !== 'com' && !hasReason(a)).length;
    if (unexplained) {
      setTimeout(() => toast(
        `${unexplained} annotation${unexplained === 1 ? '' : 's'} still without a reason — `
        + 'press \u2318\u2325R to work through them.'), 1200);
    }
  }

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    load(await files.readFile(file), file.name, null);
  });

  $('#btnOpen').addEventListener('click', open);
  $('#btnPick').addEventListener('click', open);
  $('#btnSave').addEventListener('click', save);
  // The shortcut list lives behind a button, and closes the way a menu does.
  const help = $('#help');
  const helpBtn = $('#btnHelp');
  function showHelp(on) {
    help.hidden = !on;
    helpBtn.classList.toggle('on', on);
    helpBtn.setAttribute('aria-expanded', String(on));
  }
  helpBtn.addEventListener('click', (e) => { e.stopPropagation(); showHelp(help.hidden); });
  document.addEventListener('click', (e) => {
    if (!help.hidden && !help.contains(e.target)) showHelp(false);
  });

  $('#btnCopy').addEventListener('click', async () => {
    if (!store.state.loaded) return;
    const ok = await files.copyToClipboard(store.state.text);
    toast(ok ? 'Copied the annotated markdown to the clipboard.' : 'Copy failed — use Save instead.');
  });
  $('#btnUndo').addEventListener('click', () => { store.undo(); doc.focus(); });
  $('#btnRedo').addEventListener('click', () => { store.redo(); doc.focus(); });
  $('#btnPaste').addEventListener('click', () => {
    const value = $('#pasteBox').value;
    if (!value.trim()) { toast('Paste some markdown first.'); return; }
    load(value, 'pasted.md', null);
  });

  /* --- drag and drop ------------------------------------------------------ */

  const dropZone = $('#drop');
  const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  let dragDepth = 0;

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    dropZone.classList.add('hot');
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropZone.classList.remove('hot');
  });
  window.addEventListener('drop', async (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    dragDepth = 0;
    dropZone.classList.remove('hot');
    if (store.dirty() && !confirm('Replace the current document? Unsaved annotations will be lost.')) return;
    const file = e.dataTransfer.files[0];
    load(await files.readFile(file), file.name, null);
  });

  window.addEventListener('beforeunload', (e) => {
    if (!store.dirty()) return;
    e.preventDefault();
    e.returnValue = '';
  });

  render();
  return { store, load, save };
}
