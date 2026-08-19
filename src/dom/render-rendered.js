/**
 * The rendered view.
 *
 * Markdown is shown as formatted prose, but every edit still lands in the
 * source. Two things make that safe:
 *
 *  1. **Explicit offset mappings.** The source view can map DOM to source with a
 *     running sum because it renders every character. Here `**` and `#` never
 *     reach the screen, so the renderer instead emits a mapping for each text
 *     node it creates. Anything unmapped — bullets, comment chips — is chrome
 *     the caret cannot address.
 *  2. **Markers render as state, not text.** Because we parsed block structure
 *     ourselves, a bullet whose `- ` is inside an insertion is still a bullet;
 *     it just gets tinted. That is the whole reason for the block model.
 */

import { parseInline } from '../inline.js';
import { parse } from '../criticmarkup.js';

const el = (tag, className) => {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
};
const chrome = (node) => {
  node.setAttribute('contenteditable', 'false');
  node.dataset.virtual = '1';
  return node;
};
const atomic = (node) => { node.setAttribute('contenteditable', 'false'); return node; };

/** Which tracked change, if any, is this block's marker caught up in? */
function markerState(anns, block) {
  if (block.markerStart === undefined) return null;
  for (const a of anns) {
    if (block.markerStart >= a.tok.start + 3 && block.markerStart < a.tok.end - 3) {
      if (a.type === 'ins') return 'ins';
      if (a.type === 'del') return 'del';
      if (a.type === 'sub') return 'sub';
    }
  }
  return null;
}

export function buildRendered(text, blocks, options = {}) {
  const anns = parse(text);
  const frag = document.createDocumentFragment();
  const mappings = [];

  /** Emit a mapped text node: its characters are verbatim source. */
  const emit = (parent, start, end) => {
    if (end <= start) return;
    const node = document.createTextNode(text.slice(start, end));
    parent.append(node);
    mappings.push({ node, start });
  };

  function renderNodes(parent, nodes) {
    for (const n of nodes) {
      if (n.type === 'text') { emit(parent, n.start, n.end); continue; }
      if (n.type === 'code') {
        const code = el('code');
        emit(code, n.contentStart, n.contentEnd);
        parent.append(code);
        continue;
      }
      if (n.type === 'link') {
        const a = el('a');
        a.href = n.href;
        a.title = n.href;
        a.addEventListener('click', (e) => e.preventDefault());
        renderNodes(a, n.children);
        parent.append(a);
        continue;
      }
      const tag = n.type === 'strong' ? 'strong' : 'em';
      const wrap = el(tag);
      renderNodes(wrap, n.children);
      parent.append(wrap);
    }
  }

  const commentChip = (body) => {
    const chip = chrome(el('span', 'r-com'));
    chip.textContent = body;
    chip.title = body;
    return chip;
  };

  /** Render one block's content range, tracked changes and all. */
  function renderContent(parent, from, to) {
    const segments = parseInline(text, from, to);
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.kind === 'inline') { renderNodes(parent, seg.nodes); continue; }

      if (seg.type === 'com') { parent.append(commentChip(seg.token.a)); continue; }

      const wrap = el('span', 'r-ann');
      if (seg.type === 'ins') {
        const ins = el('span', 'r-ins');
        renderNodes(ins, seg.body.nodes);
        wrap.append(ins);
      } else if (seg.type === 'del') {
        const del = atomic(el('span', 'r-del'));
        renderNodes(del, seg.body.nodes);
        wrap.append(del);
      } else if (seg.type === 'sub') {
        const del = atomic(el('span', 'r-del'));
        renderNodes(del, seg.old.nodes);
        const ins = el('span', 'r-ins');
        renderNodes(ins, seg.next.nodes);
        wrap.append(del, ins);
      } else if (seg.type === 'hl') {
        const hl = atomic(el('span', 'r-hl'));
        renderNodes(hl, seg.body.nodes);
        wrap.append(hl);
      }

      // A comment straight after an edit is its reason; render it attached.
      const next = segments[i + 1];
      if (next && next.kind === 'markup' && next.type === 'com') {
        wrap.append(commentChip(next.token.a));
        i++;
      } else {
        const marker = chrome(el('span', 'r-noreason'));
        marker.textContent = 'no reason';
        marker.dataset.ann = String(seg.start);
        marker.title = 'Click to explain this edit';
        wrap.append(marker);
      }
      wrap.dataset.start = String(seg.start);
      parent.append(wrap);
    }
  }

  /**
   * Open list containers, one per nesting depth, so consecutive items share a
   * list and a deeper item nests inside the item above it.
   */
  let stack = [];

  for (const block of blocks) {
    if (block.type === 'blank') continue;

    if (block.type === 'listItem') {
      const depth = Math.min(block.depth, 4);
      const wantTag = block.ordered ? 'ol' : 'ul';
      while (stack.length > depth + 1) stack.pop();          // leaving a deeper level
      if (!stack[depth] || stack[depth].tag !== wantTag) {
        stack.length = depth;                                // bullets became numbers, or vice versa
        const parent = depth > 0 && stack[depth - 1]
          ? stack[depth - 1].node.lastElementChild || stack[depth - 1].node
          : frag;
        const list = el(wantTag);
        parent.append(list);
        stack[depth] = { node: list, tag: wantTag };
      }
      const li = el('li');
      const state = markerState(anns, block);
      if (state) li.classList.add(`marker-${state}`);
      li.dataset.block = String(block.start);
      renderContent(li, block.contentStart, block.contentEnd);
      stack[depth].node.append(li);
      continue;
    }

    stack = [];

    if (block.type === 'unsupported') {
      const island = atomic(el('pre', `island island-${block.reason || 'other'}`));
      island.dataset.block = String(block.start);
      const label = chrome(el('span', 'island-label'));
      label.textContent = block.reason === 'code' ? 'code block' : block.reason === 'table' ? 'table' : 'raw HTML';
      island.append(label);
      const body = el('span', 'island-body');
      emit(body, block.start, block.end);
      island.append(body);
      frag.append(island);
      continue;
    }

    if (block.type === 'rule') {
      const hr = chrome(el('hr'));
      hr.dataset.block = String(block.start);
      frag.append(hr);
      continue;
    }

    let node;
    if (block.type === 'heading') {
      const state = markerState(anns, block);
      node = el(`h${Math.min(block.level, 6)}`, state ? `marker-${state}` : '');
    } else if (block.type === 'blockquote') {
      node = el('blockquote');
    } else {
      node = el('p');
    }
    node.dataset.block = String(block.start);
    renderContent(node, block.contentStart, block.contentEnd);
    if (!node.childNodes.length) emit(node, block.contentStart, block.contentEnd);
    frag.append(node);
  }

  if (options.trailingSpace !== false) {
    // A mapped landing spot at the very end, so the caret can reach the document tail.
    const tail = el('p', 'doc-tail');
    emit(tail, text.length, text.length);
    if (!tail.childNodes.length) {
      const node = document.createTextNode('');
      tail.append(node);
      mappings.push({ node, start: text.length });
    }
    frag.append(tail);
  }

  return { fragment: frag, mappings };
}
