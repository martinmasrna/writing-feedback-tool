/**
 * Mapping between DOM positions and source offsets.
 *
 * The renderer emits every source character exactly once, in order, so the
 * mapping is a running sum over the document's text nodes. Nodes marked
 * `data-virtual` are UI chrome that has no source text behind it and is skipped.
 */

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
  let total = 0;

  function edgeText(node, first) {
    if (node.nodeType === 3) return isVirtual(node) ? null : node;
    const w = textWalker(node);
    let out = null, n;
    while ((n = w.nextNode())) { out = n; if (first) break; }
    return out;
  }

  return {
    /** Rebuild after the document has been re-rendered. */
    reindex() {
      nodes = [];
      starts = [];
      total = 0;
      const w = textWalker(root);
      let n;
      while ((n = w.nextNode())) {
        nodes.push(n);
        starts.push(total);
        total += n.nodeValue.length;
      }
    },

    /** Source offset for a DOM position, or null if it maps to nothing. */
    pointToSource(node, offset) {
      if (node.nodeType === 3) {
        const i = nodes.indexOf(node);
        return i < 0 ? null : starts[i] + offset;
      }
      const kids = node.childNodes;
      if (offset < kids.length) {
        const t = edgeText(kids[offset], true);
        const i = t ? nodes.indexOf(t) : -1;
        if (i >= 0) return starts[i];
      }
      if (offset > 0) {
        const t = edgeText(kids[offset - 1], false);
        const i = t ? nodes.indexOf(t) : -1;
        if (i >= 0) return starts[i] + t.nodeValue.length;
      }
      if (node === root) return offset > 0 ? total : 0;
      return null;
    },

    /** A DOM position for a source offset, preferring somewhere the caret can live. */
    sourceToPoint(offset) {
      if (!nodes.length) return [root, 0];
      let fallback = null;
      for (let i = 0; i < nodes.length; i++) {
        const s = starts[i];
        const len = nodes[i].nodeValue.length;
        if (offset >= s && offset <= s + len) {
          if (!isAtomic(nodes[i])) return [nodes[i], offset - s];
          if (!fallback) fallback = [nodes[i], offset - s];
        }
        if (s > offset) break;
      }
      if (fallback) return fallback;
      const last = nodes.length - 1;
      return [nodes[last], nodes[last].nodeValue.length];
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
