/**
 * A DOM for the renderer to draw into, without a browser.
 *
 * `dom/render-rendered.js` and `dom/offsets.js` are the only modules in the
 * project that touch the document, and until now nothing tested them: four of
 * the bugs found by hand were "correct source, nothing visible happened", which
 * is invisible to every other test here. jsdom runs the real functions and
 * hands back the real nodes.
 *
 * The limit worth knowing: jsdom does no layout, so `getBoundingClientRect()`
 * is all zeroes. Toolbar and dialog positioning cannot be tested this way.
 */

import { JSDOM } from 'jsdom';
import { buildRendered } from '../src/dom/render-rendered.js';
import { createOffsetIndex } from '../src/dom/offsets.js';
import { toVisible } from '../src/visible.js';
import { parseVisibleBlocks } from '../src/blocks.js';
import { editor } from './harness.js';

let dom = null;

/** Install a document, once per process. The render modules read the globals. */
export function installDom() {
  if (dom) return dom.window.document;
  dom = new JSDOM('<!doctype html><html><body></body></html>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;
  return dom.window.document;
}

/**
 * Render a source document the way the app does, and hand back everything a
 * test might want to ask about it.
 */
export function render(source) {
  const doc = installDom();
  const host = doc.createElement('div');
  const { fragment, mappings } = buildRendered(source);
  host.append(fragment);
  const index = createOffsetIndex(host);
  index.reindex(mappings);
  const visible = toVisible(source);
  return { source, host, mappings, index, visible, blocks: parseVisibleBlocks(visible.text, visible.spans) };
}

/** Is this node inside chrome the caret must not be able to address? */
export const isVirtual = (node) => {
  const el = node.nodeType === 1 ? node : node.parentElement;
  return !!(el && el.closest('[data-virtual]'));
};

/** Everything on screen that is backed by real document text, in order. */
export function screenText(host) {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (isVirtual(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let out = '';
  let n;
  while ((n = walker.nextNode())) out += n.nodeValue;
  return out;
}

/** Every text node the renderer mapped, paired with the offset it claims. */
export function mappedNodes({ mappings }) {
  return mappings.map((m) => ({ text: m.node.nodeValue, start: m.start, node: m.node }));
}

/**
 * The app's loop, without the app.
 *
 * `app.js` renders after every edit, writes the caret into the DOM, and then —
 * because writing it fires `selectionchange` — reads it straight back. The
 * screen cannot represent every source offset, so that round trip is lossy, and
 * whatever comes back is what the *next* keystroke is applied to. Nothing in a
 * string test can see this: the loss only exists once there is a DOM.
 *
 * This drives the real editor with the real renderer and the real offset index
 * in between, exactly as the app does. Compare a session run through here with
 * the same session run through `editor()` alone: they must agree, or the screen
 * is changing what the document becomes.
 */
export function domSession(initial, options = {}) {
  const ed = editor(initial, options);
  const doc = installDom();
  const host = doc.createElement('div');
  doc.body.append(host);
  const index = createOffsetIndex(host);
  const readings = [];

  /** Re-render, put the caret on screen, and read back whatever survived. */
  function settle() {
    host.textContent = '';
    const { fragment, mappings } = buildRendered(ed.source);
    host.append(fragment);
    index.reindex(mappings);
    index.writeSelection(ed.caret);
    const read = index.readSelection();
    readings.push({ held: ed.caret.start, read: read && read.start });
    // `app.js` keeps the caret it holds when the reading means the same place.
    if (read && !options.trustDom) {
      const same = index.readBack(ed.caret.start) === read.start
        && index.readBack(ed.caret.end) === read.end;
      if (!same) ed.selectRange(read.start, read.end);
    } else if (read) {
      ed.selectRange(read.start, read.end);
    }
    return api;
  }

  const api = {
    ed,
    host,
    index,
    get readings() { return readings.slice(); },
    get source() { return ed.source; },
    get accepted() { return ed.accepted; },
    type(str) { for (const ch of str) { ed.act({ type: 'insertText', data: ch }); settle(); } return api; },
    press(key, times = 1) { for (let i = 0; i < times; i++) { ed.press(key); settle(); } return api; },
    caretBefore(needle) { ed.caretBefore(needle); return settle(); },
    caretAfter(needle) { ed.caretAfter(needle); return settle(); },
    select(needle) { ed.select(needle); return settle(); },
  };

  return settle();
}
