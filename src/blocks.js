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

import { transform, parse } from './criticmarkup.js';
import { toVisible, toSource, toVisibleOffset } from './visible.js';

/** Everything the rendered view is allowed to edit in place. */
export const SUPPORTED = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'rule', 'blank']);

// The content group spans newlines: once a line break is deleted, the joined
// block legitimately contains one, and `.` would refuse to match past it.
const HEADING = /^(#{1,6})([ \t]+)([\s\S]*)$/;
const BULLET = /^([ \t]*)([-*+])([ \t]+)([\s\S]*)$/;
const ORDERED = /^([ \t]*)(\d{1,9})([.)])([ \t]+)([\s\S]*)$/;
const QUOTE = /^([ \t]*)(>[ \t]?)([\s\S]*)$/;
const RULE = /^\s*((?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
const FENCE = /^\s*(```|~~~)/;
const TABLE_DELIM = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;
const HTML_BLOCK = /^\s*<[a-zA-Z!/]/;

/**
 * Split text into lines, keeping each line's absolute offsets.
 * The trailing newline belongs to the line it terminates.
 *
 * `isDeleted` lets a caller say which newlines are being removed. A deleted
 * line break no longer separates anything: pressing backspace at the top of a
 * paragraph should visibly join it to the block above, the way it does in every
 * other editor. Keeping the break would leave the screen unchanged and the
 * keystroke looking broken.
 */
export function splitLines(text, isDeleted) {
  const lines = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length) {
      if (start <= i && (start < i || lines.length === 0)) lines.push({ start, end: i, text: text.slice(start, i) });
      break;
    }
    if (text.charAt(i) === '\n' && !(isDeleted && isDeleted(i))) {
      lines.push({ start, end: i, text: text.slice(start, i) });
      start = i + 1;
    }
  }
  return lines;
}

/** Is this visible offset inside a deletion? */
export function deletedAt(spans) {
  if (!spans || !spans.length) return null;
  const removals = spans.filter((s) => s.kind === 'del');
  if (!removals.length) return null;
  return (i) => removals.some((s) => i >= s.start && i < s.end);
}

/** Classify one line of the visible document. Offsets are visible offsets. */
function classify(line) {
  const vis = line.text;
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
      contentStart: base + markerVisEnd,
      markerEnd: base + markerVisEnd,
      markerStart: base + 0,
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
      markerStart: base + indent,
      markerEnd: base + markerVisEnd,
      contentStart: base + markerVisEnd,
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
      markerStart: base + indent,
      markerEnd: base + markerVisEnd,
      contentStart: base + markerVisEnd,
      vis,
    };
  }

  const quote = vis.match(QUOTE);
  if (quote) {
    const markerVisEnd = quote[1].length + quote[2].length;
    return {
      type: 'blockquote',
      markerStart: base + quote[1].length,
      markerEnd: base + markerVisEnd,
      contentStart: base + markerVisEnd,
      vis,
    };
  }

  return { type: 'paragraph', contentStart: base, vis };
}

/** A marker and nothing else — what both halves of a marker change look like. */
const MARKER_ONLY = /^[ \t]*(?:[-*+]|\d{1,9}[.)]|#{1,6}|>)[ \t]*$/;

/**
 * The visible length of a marker at the head of this line that is being struck
 * out in favour of another, or 0.
 *
 * Both halves of a change are on screen, so demoting a heading shows `## # `
 * and turning a bullet into one shows `- ## `. Read naively the line still
 * begins with the marker that is going away.
 */
function dyingMarker(line, spans) {
  if (!spans) return 0;
  const del = spans.find((s) => s.kind === 'del' && s.start === line.start && s.end > s.start);
  if (!del) return 0;
  const ins = spans.find((s) => s.kind === 'ins' && s.annStart === del.annStart && s.start === del.end);
  if (!ins) return 0;
  const width = del.end - del.start;
  return MARKER_ONLY.test(line.text.slice(0, width)) ? width : 0;
}

/**
 * Classify a line, reading a marker mid-change as one marker.
 *
 * Without this the block keeps the type it is leaving and the marker it is
 * arriving at renders as prose: demoting `## Title` drew an `<h2>` reading
 * "# Title", and making a bullet into a heading drew a list item reading
 * "## Item" — the `- ## Title` shape that is never what anybody meant, showing
 * on screen even though the source was right.
 *
 * The half that is arriving decides what the block is; the pair together is the
 * marker, so neither half is drawn as content.
 */
function classifyLine(line, spans) {
  const dying = dyingMarker(line, spans);
  if (dying) {
    const tail = { start: line.start + dying, end: line.end, text: line.text.slice(dying) };
    const info = classify(tail);
    if (info.markerStart === tail.start) return { ...info, markerStart: line.start, vis: line.text };
  }
  return classify(line);
}

/**
 * Parse the document into blocks.
 *
 * Consecutive paragraph lines join into one block (markdown's lazy
 * continuation); everything else is one block per line. A table is detected by
 * its delimiter row and swallows the surrounding pipe lines.
 */
export function parseVisibleBlocks(visibleText, spans) {
  const lines = splitLines(visibleText, deletedAt(spans));
  const classified = [];
  let insideFence = false;
  for (const line of lines) {
    const vis = line.text;
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
    classified.push({ line, info: classifyLine(line, spans) });
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

/** Offsets on a block that must be translated from visible to source. */
const OFFSETS = ['start', 'end', 'contentStart', 'contentEnd', 'markerStart', 'markerEnd'];

/**
 * Parse block structure, returning source offsets.
 *
 * Structure is decided on the visible document — the text with tracked changes
 * resolved but both halves kept — which is why a bullet whose `- ` is inside an
 * insertion still reads as a bullet, and why a change spanning a line break
 * still produces two real lines.
 */
export function parseBlocks(text) {
  const visible = toVisible(text);
  const blocks = parseVisibleBlocks(visible.text, visible.spans);
  return blocks.map((b) => {
    const mapped = { ...b, visible: {} };
    for (const key of OFFSETS) {
      if (b[key] === undefined) continue;
      mapped.visible[key] = b[key];
      mapped[key] = toSource(visible, b[key]);
    }
    if (mapped.type === 'heading') mapped.level = headingLevel(text, mapped);
    return mapped;
  });
}

/**
 * A heading's level, read from where the marker is heading rather than from
 * both halves at once.
 *
 * Demoting `##` to `#` leaves `{~~##~>#~~}`, whose visible text is `###` — so
 * naively the block reads as level 3, a level nobody chose. Take the level the
 * change is moving toward instead.
 */
function headingLevel(text, block) {
  // Widen to whole annotations, or the slice cuts a delimiter in half and
  // resolves to nothing.
  let from = block.markerStart;
  let to = block.contentStart;
  for (const a of parse(text)) {
    if (a.start < to && a.end > from) { from = Math.min(from, a.start); to = Math.max(to, a.end); }
  }
  const marker = transform(text.slice(from, to), 'accepted');
  const hashes = /^\s*(#{1,6})/.exec(marker);
  return hashes ? hashes[1].length : block.level;
}

/**
 * The block an offset belongs to, decided on screen rather than in the source.
 *
 * Source ranges cannot answer this. A block's range runs from its first *drawn*
 * character to its last, so as soon as a block opens or closes inside an
 * annotation its range stops short of the delimiters — and a caret standing
 * between two blocks falls outside both, at a source distance that means
 * nothing. `{~~Trailing~>\n~~}{++- ++} paragraph.` puts the caret at the end of
 * the replacement, six source characters from the bullet's text and one from
 * the paragraph's; on screen it is exactly at the head of the bullet, which is
 * where the reader sees it.
 *
 * Reading it in the source sent structural commands to the wrong block
 * entirely — sometimes to the last one in the document — and a second marker
 * went in front of the first: `# 1.  one.`
 */
export function blockFor(text, offset) {
  const visible = toVisible(text);
  const blocks = parseBlocks(text);
  const at = toVisibleOffset(visible, offset);
  let nearest = null;
  let best = Infinity;
  for (const b of blocks) {
    if (at >= b.visible.start && at <= b.visible.end) return b;
    const gap = at < b.visible.start ? b.visible.start - at : at - b.visible.end;
    if (gap < best) { best = gap; nearest = b; }
  }
  return nearest;
}

/** Is this document entirely made of constructs the rendered view can edit? */
export function fullySupported(blocks) {
  return blocks.every((b) => SUPPORTED.has(b.type));
}

/** Resolve a block's content the way the reader will see it, for previews. */
export function blockPreview(text, block, mode = 'accepted') {
  return transform(text.slice(block.contentStart, block.contentEnd), mode);
}
