/**
 * The caret's place in the note, as a person counts it.
 *
 * Markdown has no document model here — the editor is a textarea over a string
 * — so a line/column readout is arithmetic on the caret offset, and nothing
 * else. Kept out of the component so it can be unit-tested against the awkward
 * cases (the very start, a trailing newline, an offset past the end, no caret at
 * all) without rendering anything.
 */

/**
 * `index` is a character offset into `text`, the way a textarea reports it.
 * Returns `{ line, column }`, both 1-based, or null when there is no caret
 * position to speak of. An offset out of range is clamped rather than thrown:
 * a status readout must never be the thing that breaks a keystroke.
 */
export const lineColumnAt = (text, index) => {
  if (typeof index !== 'number' || Number.isNaN(index)) return null;
  const source = typeof text === 'string' ? text : '';
  const offset = Math.max(0, Math.min(Math.trunc(index), source.length));
  // Counted in place rather than by slicing the head and splitting it: this runs
  // once per render of a note you are typing into, and a long note would
  // otherwise allocate an array of every line it has only to throw it away.
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  const lastBreak = source.lastIndexOf('\n', offset - 1);
  return { line, column: offset - lastBreak };
};

/** The one place the readout's wording lives: `Ln 3, Col 12`. */
export const formatLineColumn = (position) => {
  if (!position || typeof position.line !== 'number') return '';
  return `Ln ${position.line}, Col ${position.column}`;
};
