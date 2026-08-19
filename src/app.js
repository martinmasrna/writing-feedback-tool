/**
 * Wiring. Everything below is orchestration: the editing rules live in
 * edits.js, the markup rules in criticmarkup.js, and the document state in
 * state.js — all three of which are pure and tested.
 */

import { transform, hasReason } from './criticmarkup.js';
import * as edits from './edits.js';
import { createStore } from './state.js';
import { buildDocument } from './dom/render.js';
import { buildRendered } from './dom/render-rendered.js';
import { parseBlocks, blockAt } from './blocks.js';
import * as structure from './structure.js';
import { createOffsetIndex } from './dom/offsets.js';
import { createToast } from './ui/toast.js';
import { createHeader } from './ui/header.js';
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

  /** Both editing views; the two previews are read-only. */
  const editableView = () => store.state.view === 'rendered' || store.state.view === 'source';

  /** Set while we restore the caret ourselves, so it does not read as a user move. */
  let restoringCaret = false;
  /** The selection the floating toolbar is acting on. */
  let pendingSelection = null;

  /* --- rendering --------------------------------------------------------- */

  const renderHeader = createHeader({
    counts: $('#counts'), dirtyDot: $('#dirtyDot'), fileName: $('#fileName'),
    undo: $('#btnUndo'), redo: $('#btnRedo'), save: $('#btnSave'), copy: $('#btnCopy'),
    views: $('#views'), note: $('#readonlyNote'), pending: $('#pending'),
  }, {
    onView: (view) => { toolbar.hide(); store.setView(view); },
    onReviewReasons: () => reviewNextReason(),
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
    apply: $('#dlgApply'), close: $('#dlgClose'), hint: $('#dlgHint'),
  }, {
    onAnnotate: (spec, message) => {
      if (!spec) { toast(message); return; }
      store.clearActive();
      const result = edits.annotate(store.state.text, spec.selection, spec.kind, spec.text, spec.reason);
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
    if (state.view === 'rendered') {
      doc.setAttribute('contenteditable', 'true');
      doc.classList.remove('readonly');
      doc.textContent = '';
      const { fragment, mappings } = buildRendered(state.text);
      doc.append(fragment);
      offsets.reindex(mappings);
    } else if (state.view === 'source') {
      doc.setAttribute('contenteditable', 'true');
      doc.classList.remove('readonly');
      doc.textContent = '';
      doc.append(buildDocument(state.text, state.anns));
      offsets.reindex();
    } else {
      doc.setAttribute('contenteditable', 'false');
      doc.classList.add('readonly');
      doc.textContent = transform(state.text, state.view);
    }

    renderSidebar(state);
    renderHeader(state, store.dirty());
    $('#empty').style.display = state.loaded ? 'none' : 'flex';

    if (editableView() && state.caret && !dialog.open) {
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
   * instead — inline, in the sidebar, and in the header — and explained when
   * the writing is done.
   */
  function settle() {
    store.clearActive();
    return false;
  }

  /* --- selection --------------------------------------------------------- */

  function onSelectionChange() {
    const state = store.state;
    if (dialog.open || !state.loaded || !editableView()) return;
    const sel = offsets.readSelection();
    if (!sel) { pendingSelection = null; toolbar.hide(); return; }
    store.setCaret(sel);

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
    const marker = e.target.closest ? e.target.closest('.noreason, .r-noreason') : null;
    if (!marker) return;
    e.preventDefault();
    const a = marker.classList.contains('r-noreason')
      ? store.state.anns.find((x) => x.start === Number(marker.dataset.ann))
      : store.state.anns[Number(marker.dataset.ann)];
    if (a) dialog.openReasonPrompt(a, store.state.caret, rectOf(a));
  });

  function openForm(kind) {
    if (!pendingSelection || pendingSelection.end === pendingSelection.start) {
      toast('Select some text first.');
      return;
    }
    const probe = edits.annotate(store.state.text, pendingSelection, kind, '', '');
    if (probe && probe.blocked) { refuse(probe.blocked); return; }
    toolbar.hide();
    const rect = window.getSelection().rangeCount
      ? window.getSelection().getRangeAt(0).getBoundingClientRect()
      : null;
    dialog.openForm(kind, pendingSelection, store.state.text, rect);
  }

  function refuse(annotation) {
    toast(`That range crosses an existing ${annotation.type === 'hl' ? 'comment' : annotation.type} annotation. `
      + 'Annotations can’t nest or overlap — delete that one first.');
    const i = store.state.anns.indexOf(annotation);
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
    if (!editableView()) store.setView('rendered');
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
    if (result.stripped) toast('Removed CriticMarkup delimiters — they would corrupt the annotation.');
    store.apply(result);
  }

  /* --- structural commands ------------------------------------------------ */

  function runStructure(fn) {
    const state = store.state;
    if (!state.loaded || !editableView() || !state.caret) return;
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
    canEdit: () => store.state.loaded && editableView(),
    undo: () => store.undo(),
    redo: () => store.redo(),
    onComposedRender: render,
    setCaret: (caret) => { store.setCaret(caret); offsets.writeSelection(caret); },
    stepInView: (offset, dir) => offsets.step(offset, dir),
  });

  attachShortcuts({
    undo: () => store.undo(),
    redo: () => store.redo(),
    save: () => save(),
    comment: () => {
      if (pendingSelection && pendingSelection.end > pendingSelection.start) openForm('hl');
      else toast('Select the passage you want to comment on first.');
    },
    escape: () => toolbar.hide(),
    dialogOpen: () => dialog.open,
    commands,
  });

  /* --- files ------------------------------------------------------------- */

  const fileInput = $('#fileInput');

  function load(text, name, handle) {
    store.load(text, name, handle);
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
    const result = await files.saveDocument(state.text, state.name, state.handle);
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
        + 'click the counter in the header to work through them.'), 1200);
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
