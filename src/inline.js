/**
 * Inline markdown, as a closed set.
 *
 * We support bold, italic, inline code and links — the things review documents
 * actually contain — and nothing else. Anything unrecognised stays literal
 * text, which is the safe failure: unstyled prose beats mangled markup.
 *
 * Every node carries absolute source offsets, including its markers (`**`, the
 * backticks, a link's target). The rendered view hides markers as chrome; the
 * source view dims them. Either way they remain real source characters, so the
 * caret can always be mapped back.
 *
 * CriticMarkup is parsed *first* and inline parsing runs inside each resulting
 * run, so `{--**bold**--}` renders as bold and struck through, and emphasis
 * never straddles an annotation boundary.
 */

import { tokenize } from './criticmarkup.js';

const CODE = /`([^`\n]+)`/;
const STRONG = /(\*\*|__)(?=\S)([\s\S]*?\S)\1/;
const EM = /(\*|_)(?=\S)([^*_\n]*?\S)\1/;
const LINK = /\[([^\]\n]*)\]\(([^)\s]*)\)/;

/** Nodes are `text`, `strong`, `em`, `code` or `link`. */
function parseRun(text, start, end, depth = 0) {
  const slice = text.slice(start, end);
  if (!slice) return [];
  if (depth > 4) return [{ type: 'text', start, end }];

  const candidates = [];
  const push = (re, type) => {
    const m = slice.match(re);
    if (m) candidates.push({ type, index: m.index, match: m });
  };
  push(CODE, 'code');
  push(STRONG, 'strong');
  push(EM, 'em');
  push(LINK, 'link');
  if (!candidates.length) return [{ type: 'text', start, end }];

  // Earliest wins; on a tie the longer marker wins, so ** beats *.
  candidates.sort((a, b) => a.index - b.index || b.match[0].length - a.match[0].length);
  const hit = candidates[0];
  const at = start + hit.index;
  const after = at + hit.match[0].length;

  const nodes = [];
  if (at > start) nodes.push(...parseRun(text, start, at, depth + 1));

  if (hit.type === 'code') {
    nodes.push({
      type: 'code',
      start: at, end: after,
      markers: [[at, at + 1], [after - 1, after]],
      contentStart: at + 1, contentEnd: after - 1,
    });
  } else if (hit.type === 'link') {
    const labelStart = at + 1;
    const labelEnd = labelStart + hit.match[1].length;
    nodes.push({
      type: 'link',
      start: at, end: after,
      href: hit.match[2],
      markers: [[at, labelStart], [labelEnd, after]],
      contentStart: labelStart, contentEnd: labelEnd,
      children: parseRun(text, labelStart, labelEnd, depth + 1),
    });
  } else {
    const width = hit.match[1].length;
    const contentStart = at + width;
    const contentEnd = after - width;
    nodes.push({
      type: hit.type,
      start: at, end: after,
      markers: [[at, contentStart], [contentEnd, after]],
      contentStart, contentEnd,
      children: parseRun(text, contentStart, contentEnd, depth + 1),
    });
  }

  if (after < end) nodes.push(...parseRun(text, after, end, depth + 1));
  return nodes;
}

/**
 * Parse [start,end) into a list of segments.
 *
 * Segments are either `{kind:'inline', nodes}` for ordinary text or
 * `{kind:'markup', token}` for a CriticMarkup construct. A construct's body is
 * itself parsed inline, so tracked changes can contain formatting.
 */
export function parseInline(text, start, end) {
  const region = text.slice(start, end);
  const tokens = tokenize(region);
  const segments = [];

  for (const t of tokens) {
    const from = start + t.start;
    const to = start + t.end;
    if (t.type === 'plain') {
      segments.push({ kind: 'inline', start: from, end: to, nodes: parseRun(text, from, to) });
      continue;
    }
    const seg = { kind: 'markup', type: t.type, start: from, end: to, token: t };
    // Body offsets, so the body can be parsed inline and still map back.
    if (t.type === 'sub') {
      const oldStart = from + 3;
      const oldEnd = oldStart + t.a.length;
      const newStart = oldEnd + 2;
      const newEnd = to - 3;
      seg.old = { start: oldStart, end: oldEnd, nodes: parseRun(text, oldStart, oldEnd) };
      seg.next = { start: newStart, end: newEnd, nodes: parseRun(text, newStart, newEnd) };
    } else {
      const bodyStart = from + 3;
      const bodyEnd = to - 3;
      seg.body = { start: bodyStart, end: bodyEnd, nodes: parseRun(text, bodyStart, bodyEnd) };
    }
    segments.push(seg);
  }
  return segments;
}

/** Flatten to the text nodes a renderer will emit, in order, with their offsets. */
export function flatten(nodes, out = []) {
  for (const n of nodes) {
    if (n.type === 'text') out.push(n);
    else if (n.children) flatten(n.children, out);
    else out.push({ type: 'text', start: n.contentStart, end: n.contentEnd });
  }
  return out;
}
