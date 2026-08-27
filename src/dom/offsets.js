/**
 * Mapping between DOM positions and source offsets.
 *
 * The renderer emits every source character exactly once, in order, so the
 * mapping is a running sum over the document's text nodes. Nodes marked
 * `data-virtual` are UI chrome that has no source text behind it and is skipped.
 *
 * The rendered view also hands over the visible document, because *finding* the
 * node for an offset is a question about the screen. Source distance means
 * nothing across markup: the end of one line and the start of the next can be
 * six source characters apart and adjacent on the page.
 */

import { toVisibleOffset } from '../visible.js';

const isVirtual = (node) => {
  const el = node.nodeType === 1 ? node : node.parentElement;
  return !!(el && el.closest('[data-virtual]'));
};
const isAtomic = (node) => {
  const el = node.nodeType === 1 ? node : node.parentElement;
  return !!(el && el.closest('[contenteditable="false"]'));
};
/** The block-level element (paragraph, list item, heading, ...) a node sits in. */
const blockOf = (node) => {
  const el = node.nodeType === 1 ? node : node.parentElement;
  return el && el.closest('[data-block]');
};

function textWalker(root) {
  return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (isVirtual(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
}

export function createOffsetIndex(root) {
  let nodes = [];
  let starts = [];
  /** Where each node begins on screen. Equal to `starts` when every character is drawn. */
  let screen = [];
  let visible = null;
  let total = 0;
  let mapped = false;

  function edgeText(node, first) {
    if (node.nodeType === 3) return isVirtual(node) ? null : node;
    const w = textWalker(node);
    let out = null, n;
    while ((n = w.nextNode())) { out = n; if (first) break; }
    return out;
  }

  return {
    /**
     * Rebuild after the document has been re-rendered.
     *
     * The source view renders every character in order, so offsets are a
     * running sum over its text nodes. The rendered view drops markup from the
     * screen, so it supplies explicit mappings instead — one per text node it
     * emitted, each with the source offset its first character came from.
     */
    reindex(mappings, visibleDoc) {
      nodes = [];
      starts = [];
      screen = [];
      visible = visibleDoc || null;
      total = 0;
      mapped = !!mappings;
      if (mappings) {
        for (const m of mappings) {
          nodes.push(m.node);
          starts.push(m.start);
          screen.push(visible ? toVisibleOffset(visible, m.start) : m.start);
          total = Math.max(total, m.start + m.node.nodeValue.length);
        }
        return;
      }
      const w = textWalker(root);
      let n;
      while ((n = w.nextNode())) {
        nodes.push(n);
        starts.push(total);
        screen.push(total);
        total += n.nodeValue.length;
      }
    },

    /** Source offset for a DOM position, or null if it maps to nothing. */
    pointToSource(node, offset) {
      if (node.nodeType === 3) {
        const i = nodes.indexOf(node);
        return i < 0 ? null : starts[i] + offset;
      }
      // Scan past children with no source behind them. A block can end in one
      // — the bar a structural change is drawn as — and stopping at the first
      // neighbour would answer "nowhere" for the position right before it.
      const kids = node.childNodes;
      for (let k = offset; k < kids.length; k++) {
        const t = edgeText(kids[k], true);
        const i = t ? nodes.indexOf(t) : -1;
        if (i >= 0) return starts[i];
      }
      for (let k = offset - 1; k >= 0; k--) {
        const t = edgeText(kids[k], false);
        const i = t ? nodes.indexOf(t) : -1;
        if (i >= 0) return starts[i] + t.nodeValue.length;
      }
      if (node === root) return offset > 0 ? total : 0;
      return null;
    },

    /**
     * A DOM position for a source offset, preferring somewhere the caret can live.
     *
     * Everything here is measured on screen. Asked in source offsets, "which
     * node is nearest" gives the wrong answer wherever markup sits between two
     * of them: after Enter at the end of the document the caret is one source
     * character from the node on the line above and three from the one it
     * belongs to, and the node it belongs to is at exactly the right place.
     */
    sourceToPoint(offset) {
      if (!nodes.length) return [root, 0];
      const at = visible ? toVisibleOffset(visible, offset) : offset;
      let fallback = null;
      let nearest = null;
      let nearestGap = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        const s = screen[i];
        const len = nodes[i].nodeValue.length;
        if (at >= s && at <= s + len) {
          if (!isAtomic(nodes[i])) return [nodes[i], at - s];
          if (!fallback) fallback = [nodes[i], at - s];
        }
        // The rendered view leaves gaps where markup was; fall to the closest node.
        const gap = at < s ? s - at : at - (s + len);
        if (gap > 0 && gap < nearestGap && !isAtomic(nodes[i])) {
          nearestGap = gap;
          nearest = [nodes[i], at < s ? 0 : len];
        }
      }
      if (fallback) return fallback;
      if (nearest) return nearest;
      const last = nodes.length - 1;
      return [nodes[last], nodes[last].nodeValue.length];
    },

    /**
     * What this offset would read back as, once drawn.
     *
     * The screen cannot represent every source offset: the end of an insertion
     * body and the position just past its closing delimiter are the same place
     * on it, and neither a `**` nor the line break between two blocks is drawn
     * at all. So writing the caret out and reading it back is lossy, and two
     * offsets with the same answer here are the same place to a reader.
     */
    readBack(offset) {
      const [node, at] = this.sourceToPoint(offset);
      const back = this.pointToSource(node, at);
      return back === null ? offset : back;
    },

    /**
     * The next source offset the caret can actually occupy on screen, or null
     * when every character is addressable (the source view) and plain stepping
     * will do.
     *
     * The rendered view leaves whole stretches of source unaddressable: the
     * blank line between two blocks is structure, not text, so no node holds
     * it. Stepping onto one of those offsets snaps straight back and the arrow
     * key appears dead. So we walk the positions that exist instead.
     */
    step(offset, dir) {
      if (!mapped) return null;
      let best = null;
      for (let i = 0; i < nodes.length; i++) {
        if (isAtomic(nodes[i])) continue;             // struck text, comment chips
        const from = starts[i];
        const to = from + nodes[i].nodeValue.length;
        if (dir < 0) {
          const candidate = Math.min(to, offset - 1);
          if (candidate >= from && candidate < offset && (best === null || candidate > best)) best = candidate;
        } else {
          const candidate = Math.max(from, offset + 1);
          if (candidate <= to && candidate > offset && (best === null || candidate < best)) best = candidate;
        }
      }
      return best;
    },

    /**
     * Move the caret one real rendered line vertically, or null when there is
     * nowhere to go.
     *
     * Chrome's own ArrowUp/ArrowDown key handling is unreliable around an
     * empty block — an empty bullet, or the deliberately-invisible blank-line
     * separator between two paragraphs. Verified on a page with none of this
     * app's code running at all: the identical keystroke, repeated, has been
     * seen to land correctly, to skip the empty block entirely, and to drop
     * the caret out of the editable region altogether — a real, present
     * Chromium bug, not something caused by our markup or CSS.
     *
     * So Up/Down is driven by hand, the same way Left/Right already is — but
     * unlike a tried-and-reverted approach that counted `\n` characters in the
     * visible text to find "the next line" (blind to word-wrap: a wrapped
     * paragraph has none), this asks the browser's own layout directly.
     * `caretRangeFromPoint` walks real line boxes, wrapped paragraphs
     * included, because it is the same hit-testing a click uses — it just
     * never touches the native key handling that is the actual unreliable
     * part.
     *
     * How far past the current line is a real question, not a constant: a
     * collapsed range's own rect is font-metric tall (the glyph box), not the
     * block's CSS line-height, so it is far shorter than the actual gap
     * crossing into a bullet or a paragraph above one — stepping by half of
     * it lands back in the line just left. So this walks outward a few
     * pixels at a time. It is not enough to stop at the first *different
     * offset*, either — a hit-test a few pixels up can resolve to a
     * different column of the very same line (an empty bullet's own text
     * lands at the very start of the paragraph below it, offset different,
     * line the same), so a candidate still inside the block just left only
     * counts once its own rect genuinely clears that line. A candidate in a
     * *different* block is accepted on sight instead of by that same rect
     * check, because an empty block's own rect is exactly as degenerate as
     * the thing being walked past — the block boundary is the trustworthy
     * signal there, not the geometry.
     */
    vertical(dir) {
      if (!mapped || typeof document.caretRangeFromPoint !== 'function') return null;
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      const range = sel.getRangeAt(0).cloneRange();
      range.collapse(true);
      const rects = range.getClientRects();
      const rect = rects.length ? rects[0] : range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return null;

      const originBlock = blockOf(range.startContainer);
      const x = rect.left;
      const edgeY = dir < 0 ? rect.top : rect.bottom;
      const STEP = 4, MAX = 400;
      for (let d = STEP; d <= MAX; d += STEP) {
        const point = document.caretRangeFromPoint(x, edgeY + dir * d);
        if (!point || !root.contains(point.startContainer)) continue;

        if (blockOf(point.startContainer) === originBlock) {
          const pr = document.createRange();
          pr.setStart(point.startContainer, point.startOffset);
          pr.collapse(true);
          const prRects = pr.getClientRects();
          const prRect = prRects.length ? prRects[0] : pr.getBoundingClientRect();
          const crossedLine = dir < 0 ? prRect.bottom <= rect.top + 0.5 : prRect.top >= rect.bottom - 0.5;
          if (!crossedLine) continue;
        }

        const offset = this.pointToSource(point.startContainer, point.startOffset);
        if (offset !== null) return offset;
      }
      return null;
    },

    /** The current selection as source offsets, or null if it is not in the document. */
    readSelection() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      const r = sel.getRangeAt(0);
      if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
      const a = this.pointToSource(r.startContainer, r.startOffset);
      const b = this.pointToSource(r.endContainer, r.endOffset);
      if (a === null || b === null) return null;
      return { start: Math.min(a, b), end: Math.max(a, b) };
    },

    /** Put the selection back after a re-render. */
    writeSelection(caret) {
      if (!caret) return;
      try {
        const [an, ao] = this.sourceToPoint(caret.start);
        const [bn, bo] = caret.end === caret.start ? [an, ao] : this.sourceToPoint(caret.end);
        const r = document.createRange();
        r.setStart(an, ao);
        r.setEnd(bn, bo);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      } catch {
        /* Offsets moved under us; the next click re-establishes the caret. */
      }
    },
  };
}
