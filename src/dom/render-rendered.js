/**
 * The rendered view.
 *
 * Markdown is shown as formatted prose while every edit still lands in the
 * source. The pipeline is deliberately one-directional:
 *
 *   source ──▶ visible document ──▶ blocks ──▶ inline ──▶ DOM
 *              (delimiters gone,     (line       (markdown
 *               changes recorded      based)      only)
 *               as ranges)
 *
 * Resolving CriticMarkup *first*, for the whole document, is what keeps
 * delimiters out of the markdown parse. Change styling is then painted on top
 * by splitting text at change boundaries — so an edit inside emphasis or a code
 * span, or one spanning a line break, no longer breaks anything.
 *
 * The renderer emits an explicit source mapping for every text node it creates,
 * because unlike the source view it does not put every character on screen.
 * Anything unmapped — bullets, comment chips, island labels — is chrome the
 * caret cannot address.
 */

import { toVisible, toSource, sliceSpans } from '../visible.js';
import { parse } from '../criticmarkup.js';
import { parseVisibleBlocks } from '../blocks.js';
import { parseInline } from '../inline.js';

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

export function buildRendered(source) {
  const visible = toVisible(source);
  const blocks = parseVisibleBlocks(visible.text, visible.spans);
  const frag = document.createDocumentFragment();
  const mappings = [];

  const commented = new Set(visible.comments.filter((c) => c.annStart !== null).map((c) => c.annStart));
  const reasonFor = new Map(visible.comments.filter((c) => c.annStart !== null).map((c) => [c.annStart, c.text]));

  const chip = (body, annStart) => {
    const node = chrome(el('span', 'r-com'));
    node.textContent = body;
    node.title = body;
    if (annStart !== undefined) node.dataset.ann = String(annStart);
    return node;
  };
  const noReason = (annStart) => {
    const node = chrome(el('span', 'r-noreason'));
    node.textContent = 'no reason';
    node.dataset.ann = String(annStart);
    node.title = 'Click to explain this edit';
    return node;
  };

  /** Struck and highlighted text: on screen, but never typed into. */
  const unedittable = (piece) => !!piece && !!piece.kind && piece.kind !== 'ins';

  const annotations = new Map(parse(source).map((a) => [a.start, a]));

  /**
   * The source offsets either side of a piece that the caret can actually
   * occupy — the annotation's own boundaries, not the visible mapping.
   *
   * `toSource` answers with the first *drawn* character, which for struck text
   * is the one inside the opening delimiter: an offset the caret may never
   * hold. The reachable positions are before `{--` and after `--}` — after the
   * reason chip too, since that belongs to the annotation.
   *
   * Null when the piece does not span its whole annotation, which happens when
   * a deletion crosses a line break or wraps inline markdown. Those inner
   * positions are inside the markup and unreachable by design.
   */
  function edgesOf(piece) {
    const ann = annotations.get(piece.annStart);
    const span = ann && visible.spans.find((s) =>
      s.annStart === piece.annStart && s.start <= piece.start && s.end >= piece.end);
    if (!span) return { before: null, after: null };
    return {
      before: span.start === piece.start ? ann.start : null,
      after: span.end === piece.end ? ann.end : null,
    };
  }

  /**
   * A zero-width place for the caret to stand, mapped to a real source offset.
   *
   * Chrome will neither put the caret inside a `contenteditable="false"` run
   * nor at its far edge, so a deletion that ends a block leaves the position
   * after it with no text node behind it. The caret then falls to the nearest
   * node there is — the next block — and the next thing typed lands in the
   * wrong paragraph. Delete a word off the end of a paragraph and type the
   * replacement, and it appears in the one below.
   *
   * Same device as `doc-tail` and the blank-line spacers: an empty text node
   * carrying a mapping. It is *not* `data-virtual`, because unlike a bullet or
   * a comment chip there is a real source offset behind it.
   */
  function landingSpot(parent, start) {
    if (start === null) return;
    const node = document.createTextNode('');
    parent.append(node);
    mappings.push({ node, start });
  }

  /**
   * Emit visible [from,to), split at change boundaries so insertions and
   * deletions get their styling, and each piece gets a source mapping.
   */
  function emit(parent, from, to) {
    if (to <= from) return;
    const pieces = sliceSpans(visible, from, to);
    pieces.forEach((piece, i) => {
      const edges = unedittable(piece) ? edgesOf(piece) : { before: null, after: null };

      // Nothing precedes an opening run of struck text, so give it an edge.
      if (i === 0) landingSpot(parent, edges.before);

      const node = document.createTextNode(visible.text.slice(piece.start, piece.end));
      let host = parent;
      if (piece.kind) {
        const wrap = el('span', `r-${piece.kind}`);
        if (piece.kind !== 'ins') atomic(wrap);   // struck and highlighted text is not typed into
        wrap.dataset.start = String(piece.annStart);
        parent.append(wrap);
        host = wrap;
      }
      host.append(node);
      mappings.push({ node, start: toSource(visible, piece.start) });

      // The annotation ends here if the next piece belongs to another (or none).
      const next = pieces[i + 1];
      const ends = piece.annStart !== null && (!next || next.annStart !== piece.annStart);
      if (ends) {
        if (commented.has(piece.annStart)) parent.append(chip(reasonFor.get(piece.annStart), piece.annStart));
        else parent.append(noReason(piece.annStart));
      }

      // And an edge on the far side, unless ordinary text already provides one.
      if (!(next && !unedittable(next))) landingSpot(parent, edges.after);
    });
  }

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
      const wrap = el(n.type === 'strong' ? 'strong' : 'em');
      renderNodes(wrap, n.children);
      parent.append(wrap);
    }
  }

  function renderContent(parent, from, to) {
    renderNodes(parent, parseInline(visible.text, from, to));
    // Comments anchored at the very end of the block still belong to it.
    for (const c of visible.comments) {
      if (c.orphan && c.at >= from && c.at <= to) parent.append(chip(c.text, c.annStart ?? undefined));
    }
  }

  /** Which tracked change, if any, is this block's marker caught up in? */
  function markerState(block) {
    if (block.markerStart === undefined) return null;
    const hit = visible.spans.find((s) => block.markerStart >= s.start && block.markerStart < s.end);
    return hit ? hit.kind : null;
  }

  let stack = [];
  let blankRun = 0;

  for (const block of blocks) {
    // One blank line between two blocks is the separator and shows nothing.
    // Every further one is deliberate space someone made, and has to appear —
    // otherwise pressing Enter looks like it did nothing at all.
    if (block.type === 'blank') {
      blankRun++;
      if (blankRun > 1) {
        const spacer = el('p', 'blank-line');
        const node = document.createTextNode('');
        spacer.append(node);
        mappings.push({ node, start: toSource(visible, block.start) });
        (stack.length ? stack[stack.length - 1].node : frag).append(spacer);
      }
      continue;
    }
    blankRun = 0;

    if (block.type === 'listItem') {
      const depth = Math.min(block.depth, 4);
      const wantTag = block.ordered ? 'ol' : 'ul';
      while (stack.length > depth + 1) stack.pop();
      if (!stack[depth] || stack[depth].tag !== wantTag) {
        stack.length = depth;
        const parent = depth > 0 && stack[depth - 1]
          ? stack[depth - 1].node.lastElementChild || stack[depth - 1].node
          : frag;
        const list = el(wantTag);
        parent.append(list);
        stack[depth] = { node: list, tag: wantTag };
      }
      const li = el('li');
      const state = markerState(block);
      if (state) li.classList.add(`marker-${state}`);
      li.dataset.block = String(toSource(visible, block.start));
      renderContent(li, block.contentStart, block.contentEnd);
      stack[depth].node.append(li);
      continue;
    }

    stack = [];

    if (block.type === 'unsupported') {
      const island = atomic(el('pre', `island island-${block.reason || 'other'}`));
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
      frag.append(chrome(el('hr')));
      continue;
    }

    let node;
    if (block.type === 'heading') {
      const state = markerState(block);
      node = el(`h${Math.min(block.level, 6)}`, state ? `marker-${state}` : '');
    } else if (block.type === 'blockquote') {
      node = el('blockquote');
    } else {
      node = el('p');
    }
    node.dataset.block = String(toSource(visible, block.start));
    renderContent(node, block.contentStart, block.contentEnd);
    frag.append(node);
  }

  // A mapped landing spot at the end, so the caret can reach the document tail.
  const tail = el('p', 'doc-tail');
  const tailNode = document.createTextNode('');
  tail.append(tailNode);
  mappings.push({ node: tailNode, start: source.length });
  frag.append(tail);

  return { fragment: frag, mappings };
}
