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
