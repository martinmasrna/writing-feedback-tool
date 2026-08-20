/**
 * Getting documents in and out.
 *
 * Where the File System Access API is available the file is written back in
 * place; everywhere else this falls back to a download. Nothing leaves the page.
 */

const MD_TYPES = [{
  description: 'Markdown',
  accept: { 'text/markdown': ['.md', '.markdown', '.mdown'], 'text/plain': ['.txt'] },
}];

export const canPickFiles = typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * Open a document, preferring the picker so we get a handle to save back to.
 * @returns {Promise<{text,name,handle}|null>} null when the user cancels.
 */
export async function openDocument(fileInput) {
  if (canPickFiles) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: MD_TYPES });
      const file = await handle.getFile();
      return { text: await file.text(), name: file.name, handle };
    } catch (err) {
      if (err && err.name === 'AbortError') return null;
      // No picker here (some file:// contexts) — fall through to the input.
    }
  }
  fileInput.click();
  return null;
}

export function download(text, name) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'annotated.md';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Save, writing in place when we can.
 * @returns {Promise<{status:string, name?:string, handle?:FileSystemFileHandle, detail?:string}>}
 */
export async function saveDocument(text, name, handle) {
  if (handle) {
    try {
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
      return { status: 'in-place', name };
    } catch (err) {
      download(text, name);
      return { status: 'downloaded', name, detail: (err && err.name) || 'error' };
    }
  }
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const picked = await window.showSaveFilePicker({
        suggestedName: name || 'annotated.md',
        types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
      });
      const w = await picked.createWritable();
      await w.write(text);
      await w.close();
      return { status: 'linked', name: picked.name, handle: picked };
    } catch (err) {
      if (err && err.name === 'AbortError') return { status: 'cancelled' };
    }
  }
  download(text, name);
  return { status: 'downloaded', name };
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px';
    document.body.append(ta);
    ta.select();
    try {
      const ok = document.execCommand('copy');
      return ok;
    } catch {
      return false;
    } finally {
      ta.remove();
    }
  }
}
