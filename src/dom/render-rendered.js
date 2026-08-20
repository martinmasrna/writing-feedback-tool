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
 * Anything unmapped — bullets, island labels, rules — is chrome the caret
 * cannot address.
 */

import { toVisible, toSource, sliceSpans } from '../visible.js';
import { parse } from '../criticmarkup.js';
import { parseVisibleBlocks } from '../blocks.js';
import { parseInline } from '../inline.js';

const el = (tag, className, text) => {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
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

  const reasonFor = new Map(visible.comments.filter((c) => c.annStart !== null).map((c) => [c.annStart, c.text]));

  /**
   * A reason rides on the change it explains: `data-reason` for the hover
   * bubble the stylesheet draws, `unexplained` where one is still owed.
   *
   * Nothing is drawn for it. Setting the text inline put a sentence of review
   * commentary in the middle of the sentence under review; a mark after the
   * change was smaller but still a glyph in the prose, and the change is
   * already on screen with two free channels — its outline and its hover.
   * The text is read in full in the sidebar, and in the dialog ⌘⌥R opens.
   */
  function markReason(wrap, annStart, inline) {
    if (annStart === null) return;
    const reason = reasonFor.get(annStart);
    if (reason !== undefined) {
      wrap.dataset.reason = reason;
      wrap.setAttribute('aria-label', reason);
      return;
    }
    wrap.classList.add('unexplained');
    if (inline) wrap.append(addReason(annStart));
  }

  /**
   * The way to explain an edit without leaving the document.
   *
   * Hidden until the change is hovered, and absolutely positioned, so it costs
   * the prose nothing and shifts no text when it appears — the same place the
   * reason bubble occupies on a change that has one. It cannot be the bubble
   * itself: that is a pseudo-element, so a click on it lands on the change
   * underneath, which for an insertion is text the caret has to be able to
   * reach. This is a real node, and the click handler can tell them apart.
   *
   * Only inline changes get one. A structural change is a whole block, and a
   * pill that appears whenever the pointer crosses a paragraph is in the way
   * rather than to hand; those are explained from the sidebar or with ⌘⌥R.
   */
  function addReason(annStart) {
    const hit = chrome(el('span', 'add-reason'));
    hit.dataset.ann = String(annStart);
    hit.setAttribute('role', 'button');
    hit.append(el('span', 'add-reason-pill', 'Add a reason'));
    return hit;
  }


  /** Struck and highlighted text: on screen, but never typed into. */
  const unedittable = (piece) => !!piece && !!piece.kind && piece.kind !== 'ins';

  const annotations = new Map(parse(source).map((a) => [a.start, a]));

  /**
   * The source offsets either side of a piece that the caret can actually
   * occupy — the annotation's own boundaries, not the visible mapping.
   *
   * `toSource` answers with the first *drawn* character, which for struck text
   * is the one inside the opening delimiter: an offset the caret may never
   * hold. The reachable positions are before `{--` and after `--}`.
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
   * carrying a mapping. It is *not* `data-virtual`, because unlike a bullet
   * or an island label there is a real source offset behind it.
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
    /**
     * The halves of a substitution, under one roof.
     *
     * A rewrite reaches the screen as two pieces, struck then new, and left as
     * siblings each answers the pointer on its own: hovering one lit its half
     * of a change the document now holds as a single annotation, and the
     * reason it shares appeared twice, over one word and then the other. The
     * pair goes in a wrapper, and the wrapper is what carries the reason, the
     * outline and the pill.
     */
    let group = null;

    pieces.forEach((piece, i) => {
      const edges = unedittable(piece) ? edgesOf(piece) : { before: null, after: null };
      const next = pieces[i + 1];

      // Nothing precedes an opening run of struck text, so give it an edge.
      if (i === 0) landingSpot(parent, edges.before);

      if (!group && piece.annStart !== null && next && next.annStart === piece.annStart) {
        group = el('span', 'r-sub');
        group.dataset.start = String(piece.annStart);
        markReason(group, piece.annStart, true);
        parent.append(group);
      }
      const home = group || parent;

      const node = document.createTextNode(visible.text.slice(piece.start, piece.end));
      let host = home;
      if (piece.kind) {
        const wrap = el('span', `r-${piece.kind}`);
        if (piece.kind !== 'ins') atomic(wrap);   // struck and highlighted text is not typed into
        wrap.dataset.start = String(piece.annStart);
        if (!group) markReason(wrap, piece.annStart, true);
        home.append(wrap);
        host = wrap;
      }
      host.append(node);
      mappings.push({ node, start: toSource(visible, piece.start) });

      if (group && (!next || next.annStart !== piece.annStart)) group = null;

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
    // A block with nothing in it yet — the bullet Enter has just opened, an
    // empty heading — is drawn, has height, and has nowhere for the caret to
    // be. Without a spot it falls to the end of the document, outside the list
    // it was meant to be in.
    if (to <= from) landingSpot(parent, toSource(visible, from));
    renderNodes(parent, parseInline(visible.text, from, to));
    // A comment with no annotation before it — one an agent wrote into the
    // file without anchoring it — draws nothing here. There is no change to
    // shade and no text of its own, and a glyph in the prose is what this view
    // stopped having. The sidebar lists it, reads it and edits it.
  }

  /**
   * The tracked change this block's marker is caught up in, if any.
   *
   * A substitution puts both halves on screen, and `pair` marks them. That is a
   * marker being *replaced*, not struck out: a bullet becoming a heading is not
   * a deletion and must not wear the same red ✕ as one.
   *
   * The annotation's offset comes back too, and goes on the block element. It
   * is the only thing on screen standing for that edit — the marker is drawn as
   * a bullet or a heading, never as text with a span around it — so without it
   * the sidebar has nothing to scroll to and clicking a structural change did
   * nothing at all.
   */
  function markerChange(block) {
    if (block.markerStart === undefined) return null;
    const hit = visible.spans.find((s) => block.markerStart >= s.start && block.markerStart < s.end);
    if (!hit) return null;
    return { kind: hit.pair ? 'sub' : hit.kind, annStart: hit.annStart };
  }

  /** Mark a block whose marker is mid-change, and let it be scrolled to. */
  function tintMarker(node, block) {
    const change = markerChange(block);
    if (!change) return;
    node.classList.add(`marker-${change.kind}`);
    node.dataset.start = String(change.annStart);
  }

  /**
   * The bar in the margin, as a node rather than a pseudo-element.
   *
   * A structural change has no text of its own to hover — the change is a
   * bullet or a heading level, and the prose beside it is untouched. The bar
   * is the only thing on screen that stands for it, so it has to be the thing
   * you point at: it carries the reason on hover and the pill when one is
   * still owed, exactly as an inline change does.
   *
   * It reaches wider than the 2px it draws, because 2px is not a target, and
   * it goes in last so that no caret position resolves against it.
   */
  function markerHandle(node, block) {
    const change = markerChange(block);
    if (!change) return;
    const bar = chrome(el('span', `marker-bar marker-${change.kind}`));
    markReason(bar, change.annStart, true);
    node.append(bar);
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
      tintMarker(li, block);
      li.dataset.block = String(toSource(visible, block.start));
      renderContent(li, block.contentStart, block.contentEnd);
      markerHandle(li, block);
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
      node = el(`h${Math.min(block.level, 6)}`);
      tintMarker(node, block);
    } else if (block.type === 'blockquote') {
      node = el('blockquote');
    } else {
      node = el('p');
    }
    node.dataset.block = String(toSource(visible, block.start));
    renderContent(node, block.contentStart, block.contentEnd);
    if (block.type === 'heading') markerHandle(node, block);
    frag.append(node);
  }

  // A mapped landing spot at the end, so the caret can reach the document tail.
  const tail = el('p', 'doc-tail');
  const tailNode = document.createTextNode('');
  tail.append(tailNode);
  mappings.push({ node: tailNode, start: source.length });
  frag.append(tail);

  return { fragment: frag, mappings, visible };
}
