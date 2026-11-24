/**
 * Who wrote which characters.
 *
 * Every write already knows its author and the text before it, so the answer is
 * recorded at write time rather than reconstructed afterwards: a span on the note
 * row holds the ranges of the current text that an agent wrote.
 *
 * Two operations do all the work:
 *
 *   remapSpans  move the existing spans through an edit by anyone
 *   addedSpan   the characters one edit brought in
 *
 * An agent's write adds its region; a person's write only remaps (their new
 * words are theirs, so they never gain a span), and text either side replaced
 * stops being the agent's. There is no second record to drift: the spans are
 * stored with the text they describe.
 */

export const isAgentActor = (actorId) =>
  typeof actorId === 'string' &&
  (actorId === 'agent' || actorId === 'agent_rudi' || actorId.startsWith('agent_'));

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

const mergeRanges = (ranges) => {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else if (range.end > range.start) {
      merged.push({ ...range });
    }
  }
  return merged;
};

/**
 * How one edit maps onto the text around it.
 *
 * The cheapest honest diff: the unchanged head, the unchanged tail, and one
 * changed region between them. Appending, editing a word, or replacing a
 * paragraph all fit this shape, and it costs one pass over each string.
 */
export const changedRegion = (before, after) => {
  const a = typeof before === 'string' ? before : '';
  const b = typeof after === 'string' ? after : '';
  const max = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < max && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < max - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix += 1;
  return {
    beforeStart: prefix,
    beforeEnd: a.length - suffix,
    afterStart: prefix,
    afterEnd: b.length - suffix,
  };
};

/** The span of `after` that the edit brought in, or null for a pure deletion. */
export const addedSpan = (before, after) => {
  const region = changedRegion(before, after);
  return region.afterEnd > region.afterStart
    ? { start: region.afterStart, end: region.afterEnd }
    : null;
};

/**
 * Move existing spans through an edit.
 *
 * A span before the change keeps its place, one after it moves by the length
 * difference, and one that overlaps keeps only the part still present — text the
 * person replaced is no longer the agent's writing.
 */
export const remapSpans = (spans, before, after, { insertGrows = false } = {}) => {
  if (!Array.isArray(spans) || spans.length === 0) return [];
  const a = typeof before === 'string' ? before : '';
  const b = typeof after === 'string' ? after : '';
  if (a === b) return spans;
  const { beforeStart, beforeEnd } = changedRegion(a, b);
  const delta = b.length - a.length;
  const pureInsert = beforeEnd === beforeStart;
  const mapped = [];
  for (const span of spans) {
    const start = clamp(Number(span.start) || 0, 0, a.length);
    const end = clamp(Number(span.end) || 0, start, a.length);
    if (end <= beforeStart) {
      mapped.push({ start, end });
    } else if (start >= beforeEnd) {
      mapped.push({ start: start + delta, end: end + delta });
    } else if (pureInsert && start < beforeStart && end > beforeStart) {
      // Typing in the middle of the agent's text. An agent's own words join the
      // block; a person's start a new one, so their sentence is never painted as
      // the agent's.
      if (insertGrows) {
        mapped.push({ start, end: end + delta });
      } else {
        mapped.push({ start, end: beforeStart });
        mapped.push({ start: beforeStart + delta, end: end + delta });
      }
    } else if (start < beforeStart && end > beforeEnd) {
      // The edit sits inside the agent's text: the two sides stay, joined.
      mapped.push({ start, end: end + delta });
    } else if (start < beforeStart) {
      mapped.push({ start, end: beforeStart });
    } else if (end > beforeEnd) {
      mapped.push({ start: beforeStart, end: end + delta });
    }
    // Anything else was inside the replaced region: it is gone.
  }
  return mergeRanges(
    mapped.map((span) => ({
      start: clamp(span.start, 0, b.length),
      end: clamp(span.end, 0, b.length),
    }))
  );
};

/** Spans after a write by `actorId`: an agent's new words are added, a person's are not. */
export const spansAfterWrite = ({ before, after, spans, actorId }) => {
  const remapped = remapSpans(spans, before, after, { insertGrows: isAgentActor(actorId) });
  if (!isAgentActor(actorId)) return remapped;
  const added = addedSpan(before, after);
  return added ? mergeRanges([...remapped, added]) : remapped;
};

/** Total characters an agent is responsible for, for a one-line summary. */
export const agentSpanBytes = (spans) =>
  Array.isArray(spans)
    ? spans.reduce((total, span) => total + Math.max(0, span.end - span.start), 0)
    : 0;
