/**
 * Turn the note and a proposal into the note plus the proposal.
 *
 * The awkward part of applying someone else's paragraph is that the note moved
 * on since they wrote it, so the offsets they meant are not the offsets now.
 * The proposal carries the revision it was written against and nothing else;
 * this file reconstructs where it was written and decides, honestly, whether it
 * still fits.
 *
 * Three rules, in order:
 *
 * 1. The same revision — the note has not changed since, so the proposal is
 *    appended as its own paragraph. That is the common case and the safe one.
 * 2. A newer revision — the note changed, but this passage is still in it, so
 *    the proposal goes after that passage and the rest of the note is untouched.
 * 3. No anchor — the note has been rewritten around the passage, and appending
 *    would drop a paragraph into a place it was never meant for. That is
 *    `stale`, and the person is told instead of being handed a mess.
 *
 * Rule 2 needs to know what the note looked like at the proposal's revision, so
 * the caller passes the versions it can see. Without them, a proposal written
 * for another revision is `stale` — an honest refusal beats a guess about
 * somebody's prose.
 */

/** Collapse runs of whitespace so a paragraph survives a reformat. */
const normalize = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/**
 * The last non-trivial paragraph of the note, which is what a proposal is
 * written "after". Trivial means a heading or a blank line: those are structure,
 * not an anchor a person would point at.
 */
export function anchorOf(content) {
  if (typeof content !== 'string' || content.trim() === '') return null;
  const paragraphs = content.split(/\n{2,}/);
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    const candidate = normalize(paragraphs[index]);
    if (candidate.length >= 20 && !candidate.startsWith('#')) {
      return paragraphs[index];
    }
  }
  return null;
}

/** True when the passage still appears anywhere in the note's text. */
const stillPresent = (anchor, content) => {
  const needle = normalize(anchor);
  if (!needle) return false;
  return normalize(content).includes(needle);
};

/** Put `text` after the paragraph holding `anchor`, or at the end. */
const insertAfter = (content, anchor, text) => {
  if (!anchor) return `${content.replace(/\s+$/, '')}\n\n${text}\n`;
  const needle = normalize(anchor);
  const paragraphs = content.split(/\n{2,}/);
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    if (normalize(paragraphs[index]).includes(needle) || needle.includes(normalize(paragraphs[index]))) {
      const rebuilt = [
        ...paragraphs.slice(0, index + 1),
        text,
        ...paragraphs.slice(index + 1).filter((part) => part.trim() !== ''),
      ];
      return `${rebuilt.join('\n\n')}\n`;
    }
  }
  return `${content.replace(/\s+$/, '')}\n\n${text}\n`;
};

/**
 * @param {object} args
 * @param {string} args.content      the note as it is now
 * @param {number|null} args.revision the note's revision now
 * @param {string} args.proposal     the text being applied
 * @param {number|null} args.baseRevision the revision the proposal was written against
 * @param {Array<{revision: number, content: string}>} [args.versions]
 *        older versions, so an anchor from another revision can still be found
 * @returns {{status: 'applied', content: string, anchor: string|null} | {status: 'stale', reason: string}}
 */
export function applyProposal({ content, revision, proposal, baseRevision, versions = [] }) {
  const text = String(proposal ?? '').trim();
  if (!text) return { status: 'stale', reason: 'empty proposal' };

  const current = typeof content === 'string' ? content : '';
  const sameRevision =
    Number.isInteger(baseRevision) && Number.isInteger(revision) ? baseRevision === revision : baseRevision == null;

  if (sameRevision) {
    return { status: 'applied', content: insertAfter(current, anchorOf(current), text), anchor: anchorOf(current) };
  }

  // The note moved on. Find where the proposal was written, then check that place
  // still exists — a passage that was rewritten is not a place to insert after.
  const base = versions.find((version) => version?.revision === baseRevision);
  const anchor = base ? anchorOf(base.content) : null;
  if (!anchor || !stillPresent(anchor, current)) {
    return {
      status: 'stale',
      reason: base ? 'the passage it was written after is gone' : 'the version it was written against is not available',
    };
  }
  return { status: 'applied', content: insertAfter(current, anchor, text), anchor };
}
