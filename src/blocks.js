/**
 * Block structure.
 *
 * The rendered view needs to know what each line *is* — a heading, a list item,
 * a paragraph — and exactly which source characters make up its marker versus
 * its content. We parse that ourselves rather than handing the document to a
 * markdown library, for one decisive reason: a list marker can itself be a
 * tracked change. `{++- ++}Some text` is a bullet that was *added*, and it has
 * to render as a bullet, tinted as an insertion. A general markdown parser
 * never sees a list there at all.
 *
 * Parsing is line-based, which is how markdown block structure actually works,
 * and it is pure: source string in, block descriptors with offsets out.
 *
 * Blocks we do not fully understand are `unsupported`. They render as read-only
 * islands and are edited in the source view. Never guess at structure — a
 * mangled code fence is worse than one you cannot edit in place.
 */

import { transform } from './criticmarkup.js';

/** Everything the rendered view is allowed to edit in place. */
export const SUPPORTED = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'rule', 'blank']);

const HEADING = /^(#{1,6})(\s+)(.*)$/;
const BULLET = /^(\s*)([-*+])(\s+)(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})([.)])(\s+)(.*)$/;
const QUOTE = /^(\s*)(>\s?)(.*)$/;
const RULE = /^\s*((?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
const FENCE = /^\s*(```|~~~)/;
const TABLE_DELIM = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;
const HTML_BLOCK = /^\s*<[a-zA-Z!/]/;

/**
 * Split text into lines, keeping each line's absolute source offsets.
 * The trailing newline belongs to the line it terminates.
 */
export function splitLines(text) {
  const lines = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length) {
      if (start <= i && (start < i || lines.length === 0)) lines.push({ start, end: i, text: text.slice(start, i) });
      break;
    }
    if (text.charAt(i) === '\n') {
      lines.push({ start, end: i, text: text.slice(start, i) });
      start = i + 1;
    }
  }
  return lines;
}

/**
 * What does this line look like once its tracked changes are resolved?
 *
 * A marker that is being inserted (`{++- ++}text`) should already behave as a
 * marker; one that is being deleted (`{--- --}text`) should still behave as a
 * marker until the change is accepted. So we classify against the text with all
 * markup *stripped but kept* — both halves present — which is what the reader
 * sees on screen.
 */
function visibleText(line) {
  // Keep insertions and deletions both visible; drop only the delimiters.
  return line
    .replace(/\{\+\+([\s\S]*?)\+\+\}/g, '$1')
    .replace(/\{--([\s\S]*?)--\}/g, '$1')
    .replace(/\{~~([\s\S]*?)~>([\s\S]*?)~~\}/g, '$1$2')
    .replace(/\{==([\s\S]*?)==\}/g, '$1')
    .replace(/\{>>[\s\S]*?<<\}/g, '');
}

/**
 * Map an offset in a line's visible text back to an offset in its raw text.
 * Walks both in step, skipping delimiters and comment bodies.
 */
export function visibleToRaw(raw, visibleOffset) {
  const DELIMS = ['{++', '++}', '{--', '--}', '{~~', '~~}', '{==', '==}', '~>'];
  let v = 0;
  let i = 0;
  while (i < raw.length) {
    // Step over markup *before* testing the position, so the offset we return
    // always lands on a real character rather than inside a delimiter.
    if (raw.startsWith('{>>', i)) {
      const close = raw.indexOf('<<}', i);
      i = close < 0 ? raw.length : close + 3;
      continue;
    }
    const d = DELIMS.find((x) => raw.startsWith(x, i));
    if (d) { i += d.length; continue; }
    if (v === visibleOffset) return i;
    i++;
    v++;
  }
  return i;
}

/** Classify one line. Offsets returned are absolute source offsets. */
function classify(line) {
  const raw = line.text;
  const vis = visibleText(raw);
  const base = line.start;

  if (HTML_BLOCK.test(vis)) return { type: 'unsupported', reason: 'html', vis };
  if (vis.trim() === '') return { type: 'blank', vis };
  if (RULE.test(vis)) return { type: 'rule', vis };

  const heading = vis.match(HEADING);
  if (heading) {
    const markerVisEnd = heading[1].length + heading[2].length;
    return {
      type: 'heading',
      level: heading[1].length,
      contentStart: base + visibleToRaw(raw, markerVisEnd),
      markerEnd: base + visibleToRaw(raw, markerVisEnd),
      markerStart: base + visibleToRaw(raw, 0),
      vis,
    };
  }

  const bullet = vis.match(BULLET);
  if (bullet) {
    const indent = bullet[1].length;
    const markerVisEnd = indent + bullet[2].length + bullet[3].length;
    return {
      type: 'listItem',
      ordered: false,
      marker: bullet[2],
      depth: Math.floor(indent / 2),
      indent,
      markerStart: base + visibleToRaw(raw, indent),
      markerEnd: base + visibleToRaw(raw, markerVisEnd),
      contentStart: base + visibleToRaw(raw, markerVisEnd),
      vis,
    };
  }

  const ordered = vis.match(ORDERED);
  if (ordered) {
    const indent = ordered[1].length;
    const markerVisEnd = indent + ordered[2].length + ordered[3].length + ordered[4].length;
    return {
      type: 'listItem',
      ordered: true,
      marker: ordered[2] + ordered[3],
      number: Number(ordered[2]),
      depth: Math.floor(indent / 2),
      indent,
      markerStart: base + visibleToRaw(raw, indent),
      markerEnd: base + visibleToRaw(raw, markerVisEnd),
      contentStart: base + visibleToRaw(raw, markerVisEnd),
      vis,
    };
  }

  const quote = vis.match(QUOTE);
  if (quote) {
    const markerVisEnd = quote[1].length + quote[2].length;
    return {
      type: 'blockquote',
      markerStart: base + visibleToRaw(raw, quote[1].length),
      markerEnd: base + visibleToRaw(raw, markerVisEnd),
      contentStart: base + visibleToRaw(raw, markerVisEnd),
      vis,
    };
  }

  return { type: 'paragraph', contentStart: base, vis };
}

/**
 * Parse the document into blocks.
 *
 * Consecutive paragraph lines join into one block (markdown's lazy
 * continuation); everything else is one block per line. A table is detected by
 * its delimiter row and swallows the surrounding pipe lines.
 */
export function parseBlocks(text) {
  const lines = splitLines(text);
  const classified = [];
  let insideFence = false;
  for (const line of lines) {
    const vis = visibleText(line.text);
    if (insideFence) {
      classified.push({ line, info: { type: 'unsupported', reason: 'code', vis } });
      if (FENCE.test(vis)) insideFence = false;   // the closing fence
      continue;
    }
    if (FENCE.test(vis)) {
      insideFence = true;
      classified.push({ line, info: { type: 'unsupported', reason: 'code', vis } });
      continue;
    }
    classified.push({ line, info: classify(line) });
  }

  // A delimiter row turns its neighbours into one unsupported table block.
  for (let i = 0; i < classified.length; i++) {
    if (classified[i].info.type === 'unsupported') continue;
    if (!TABLE_DELIM.test(classified[i].info.vis)) continue;
    let from = i;
    while (from > 0 && classified[from - 1].info.vis.includes('|')) from--;
    let to = i;
    while (to + 1 < classified.length && classified[to + 1].info.vis.includes('|')) to++;
    for (let j = from; j <= to; j++) classified[j].info = { type: 'unsupported', reason: 'table', vis: classified[j].info.vis };
  }

  const blocks = [];
  for (let i = 0; i < classified.length; i++) {
    const { line, info } = classified[i];
    const block = {
      ...info,
      start: line.start,
      end: line.end,
      contentStart: info.contentStart ?? line.start,
      contentEnd: line.end,
      lines: 1,
    };

    if (info.type === 'paragraph' || info.type === 'unsupported') {
      // Absorb following lines of the same kind into one block.
      while (i + 1 < classified.length) {
        const next = classified[i + 1];
        const sameKind = next.info.type === info.type
          && (info.type !== 'unsupported' || next.info.reason === info.reason);
        if (!sameKind) break;
        block.end = next.line.end;
        block.contentEnd = next.line.end;
        block.lines++;
        i++;
      }
    }
    blocks.push(block);
  }
  return blocks;
}

/** The block containing an offset, or the nearest one. */
export function blockAt(blocks, offset) {
  for (const b of blocks) {
    if (offset >= b.start && offset <= b.end) return b;
  }
  return blocks[blocks.length - 1] || null;
}

/** Is this document entirely made of constructs the rendered view can edit? */
export function fullySupported(blocks) {
  return blocks.every((b) => SUPPORTED.has(b.type));
}

/** Resolve a block's content the way the reader will see it, for previews. */
export function blockPreview(text, block, mode = 'accepted') {
  return transform(text.slice(block.contentStart, block.contentEnd), mode);
}
