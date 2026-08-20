/**
 * Getting the document out.
 *
 * This is the moment the user's work leaves the app, and the branching is the
 * part that can lose it: save in place when there is a handle, ask for one when
 * there is not, fall back to a download when neither works, and do nothing at
 * all when the user cancels. Getting that wrong reads as "I pressed save and
 * nothing happened".
 *
 * The File System Access API itself needs a real browser and a real click. What
 * is checked here is the decision, against handles and pickers that record what
 * they were asked to do.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom.js';
import { saveDocument, copyToClipboard } from '../src/files.js';

installDom();

// A download ends in an anchor click, which jsdom answers with a navigation
// warning. Record the attempt instead.
const downloads = [];
window.HTMLAnchorElement.prototype.click = function click() { downloads.push(this.download); };
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.URL.revokeObjectURL = () => {};
// `download()` schedules the revoke a second and a half out, which would hold
// the test runner open for exactly that long after the last assertion.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms >= 1000 ? 0 : ms, ...rest);

/** A handle of the shape the File System Access API hands back. */
function fakeHandle(name, onWrite) {
  const wrote = [];
  return {
    name,
    wrote,
    createWritable: async () => ({
      write: async (text) => { if (onWrite) onWrite(); wrote.push(text); },
      close: async () => {},
    }),
  };
}

const ANNOTATED = '# T\n\nAlpha {--beta--}{>>too vague<<} gamma.\n';

test('with a handle, the document is written back in place', async () => {
  const handle = fakeHandle('doc.md');
  const result = await saveDocument(ANNOTATED, 'doc.md', handle);
  assert.deepEqual(result, { status: 'in-place', name: 'doc.md' });
  assert.deepEqual(handle.wrote, [ANNOTATED], 'the annotated source, exactly — not the accepted text');
});

test('a handle that fails falls back to a download rather than losing the work', async () => {
  downloads.length = 0;
  const handle = fakeHandle('doc.md', () => { const e = new Error('gone'); e.name = 'NotAllowedError'; throw e; });
  const result = await saveDocument(ANNOTATED, 'doc.md', handle);
  assert.equal(result.status, 'downloaded');
  assert.equal(result.detail, 'NotAllowedError', 'and says why');
  assert.deepEqual(downloads, ['doc.md']);
});

test('with no handle the picker is asked, and its handle is kept for next time', async () => {
  const picked = fakeHandle('chosen.md');
  window.showSaveFilePicker = async () => picked;
  const result = await saveDocument(ANNOTATED, 'doc.md', null);
  assert.equal(result.status, 'linked');
  assert.equal(result.name, 'chosen.md');
  assert.equal(result.handle, picked, 'so the next save writes in place');
  assert.deepEqual(picked.wrote, [ANNOTATED]);
});

test('cancelling the picker saves nothing and downloads nothing', async () => {
  downloads.length = 0;
  window.showSaveFilePicker = async () => { const e = new Error('no'); e.name = 'AbortError'; throw e; };
  const result = await saveDocument(ANNOTATED, 'doc.md', null);
  assert.deepEqual(result, { status: 'cancelled' });
  assert.deepEqual(downloads, [], 'a cancelled save is not a download');
});

test('a picker that fails for any other reason still gets the document out', async () => {
  downloads.length = 0;
  window.showSaveFilePicker = async () => { throw new Error('broken'); };
  const result = await saveDocument(ANNOTATED, 'doc.md', null);
  assert.equal(result.status, 'downloaded');
  assert.deepEqual(downloads, ['doc.md']);
});

test('with no picker at all, a download', async () => {
  downloads.length = 0;
  delete window.showSaveFilePicker;
  const result = await saveDocument(ANNOTATED, 'doc.md', null);
  assert.equal(result.status, 'downloaded');
  assert.deepEqual(downloads, ['doc.md']);
});

test('an unnamed document still gets a filename', async () => {
  downloads.length = 0;
  delete window.showSaveFilePicker;
  await saveDocument(ANNOTATED, '', null);
  assert.deepEqual(downloads, ['annotated.md']);
});

test('copying puts the annotated source on the clipboard', async () => {
  let copied = null;
  // Node defines `navigator` as a getter, so it has to be replaced outright.
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async (t) => { copied = t; } } },
    configurable: true,
  });
  assert.equal(await copyToClipboard(ANNOTATED), true);
  assert.equal(copied, ANNOTATED, 'the source with its annotations, not a preview of it');
});
