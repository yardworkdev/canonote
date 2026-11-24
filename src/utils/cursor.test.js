import { describe, it, expect } from 'vitest';
import { formatLineColumn, lineColumnAt } from './cursor';

describe('lineColumnAt', () => {
  const text = 'first\nsecond\n\nfourth';

  it('counts from one at the very start', () => {
    expect(lineColumnAt(text, 0)).toEqual({ line: 1, column: 1 });
  });

  it('counts a column inside the first line', () => {
    expect(lineColumnAt(text, 3)).toEqual({ line: 1, column: 4 });
  });

  it('moves to the next line at the newline itself', () => {
    // The character right after the first newline is line 2, column 1.
    expect(lineColumnAt(text, 6)).toEqual({ line: 2, column: 1 });
  });

  it('counts a column on a later line', () => {
    // 'second' starts at 6, so 6 + 4 = 10 is the 5th column of line 2.
    expect(lineColumnAt(text, 10)).toEqual({ line: 2, column: 5 });
  });

  it('treats an empty line as a line of its own', () => {
    // The blank third line: offset 13 is its first column.
    expect(lineColumnAt(text, 13)).toEqual({ line: 3, column: 1 });
  });

  it('counts the end of the text', () => {
    expect(lineColumnAt(text, text.length)).toEqual({ line: 4, column: 7 });
  });

  it('clamps an offset past the end instead of throwing', () => {
    expect(lineColumnAt(text, text.length + 500)).toEqual({ line: 4, column: 7 });
  });

  it('clamps a negative offset to the start', () => {
    expect(lineColumnAt(text, -4)).toEqual({ line: 1, column: 1 });
  });

  it('truncates a fractional offset', () => {
    expect(lineColumnAt(text, 2.7)).toEqual({ line: 1, column: 3 });
  });

  it('has no position without a caret', () => {
    expect(lineColumnAt(text, null)).toBeNull();
    expect(lineColumnAt(text, undefined)).toBeNull();
    expect(lineColumnAt(text, Number.NaN)).toBeNull();
  });

  it('survives a missing or non-string text', () => {
    expect(lineColumnAt(null, 0)).toEqual({ line: 1, column: 1 });
    // No text means nothing to be at offset 4 of: clamped to the start.
    expect(lineColumnAt(undefined, 4)).toEqual({ line: 1, column: 1 });
  });

  it('handles a trailing newline as a last, empty line', () => {
    expect(lineColumnAt('a\n', 2)).toEqual({ line: 2, column: 1 });
  });

  it('counts unicode by the units a textarea reports, not by glyph', () => {
    // A surrogate pair is two units in a textarea's offset, and the readout
    // counts what the editor counts — the alternative is a number that disagrees
    // with the selection it describes.
    expect(lineColumnAt('👩‍💻 x', 3)).toEqual({ line: 1, column: 4 });
  });
});

describe('formatLineColumn', () => {
  it('formats a position', () => {
    expect(formatLineColumn({ line: 3, column: 12 })).toBe('Ln 3, Col 12');
  });

  it('is empty without a position', () => {
    expect(formatLineColumn(null)).toBe('');
    expect(formatLineColumn({})).toBe('');
  });
});
