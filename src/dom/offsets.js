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

import { toSource, toVisibleOffset } from '../visible.js';

const isVirtual = (node) => {
  const el = node.nodeType === 1 ? node : node.parentElement;
  return !!(el && el.closest('[data-virtual]'));
};
const isAtomic = (node) => {
  const el = node.nodeType === 1 ? node : node.parentElement;
  return !!(el && el.closest('[contenteditable="false"]'));
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
     * The rendered view has to step over its mapped blank-line landing spots as
     * well as ordinary text. Walking the rendered positions keeps left/right
     * movement consistent with the source offsets behind the markup.
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

    /** Move one rendered line vertically, including blank Markdown lines. */
    vertical(offset, dir) {
      if (!mapped || !visible) return null;
      const text = visible.text;
      const at = toVisibleOffset(visible, offset);
      const starts = [0];
      for (let i = 0; i < text.length; i++) {
        if (text.charAt(i) === '\n') starts.push(i + 1);
      }

      let line = 0;
      for (let i = 1; i < starts.length && starts[i] <= at; i++) line = i;
      const targetLine = line + dir;
      if (targetLine < 0 || targetLine >= starts.length) return null;

      const currentStart = starts[line];
      const currentEnd = line + 1 < starts.length ? starts[line + 1] - 1 : text.length;
      const targetStart = starts[targetLine];
      const targetEnd = targetLine + 1 < starts.length ? starts[targetLine + 1] - 1 : text.length;
      const column = Math.max(0, Math.min(at - currentStart, currentEnd - currentStart));
      const target = targetStart + Math.min(column, targetEnd - targetStart);
      return target >= text.length ? visible.sourceLength : toSource(visible, target);
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
