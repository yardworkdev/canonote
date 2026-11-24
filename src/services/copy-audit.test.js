import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  COPY_AUDIT_SKIP,
  COPY_RULES,
  COPY_VAGUE_PHRASES,
  auditCopy,
  extractCopy,
  looksLikeClassList,
  looksLikeCopy,
  stripComments,
} from './copy-audit';

/**
 * The standard is only real if it bites, so the rules are exercised against copy
 * that breaks them before they are run over the app. Every case below is a
 * string the app actually shipped (2026-10-16) — `Exported!`, the boundary's
 * "Something went wrong", the print document's emoji.
 */
const rulesFor = (source, jsx = true) => auditCopy(extractCopy(source, { jsx })).flatMap((v) => v.rules);

describe('the copy rules', () => {
  it('catches a message that shouts', () => {
    expect(rulesFor('<span>Exported!</span>')).toContain('no-shouting');
    expect(rulesFor("<span>Copied to clipboard!</span>")).toContain('no-shouting');
  });

  it('catches an emoji in the copy', () => {
    expect(rulesFor('<button>🖨️ Print / Save as PDF</button>')).toContain('no-emoji');
  });

  it('catches blame and apology', () => {
    expect(rulesFor('<p>Sorry, the note could not be saved.</p>')).toContain('no-blame');
    expect(rulesFor("<p>Oops, that did not work.</p>")).toContain('no-blame');
    expect(rulesFor('<p>The note was successfully saved.</p>')).toContain('no-blame');
  });

  it('does not catch a word that merely contains a banned one', () => {
    // "adjust" is not the filler "just", which is why the banned words match at
    // a word start and the catalog's `just` is not on this list at all.
    expect(rulesFor('<p>Adjust the folder, then try again.</p>')).toEqual([]);
    expect(rulesFor('<p>Edited just now.</p>')).toEqual([]);
  });

  it('catches a failure that states no fact', () => {
    for (const phrase of COPY_VAGUE_PHRASES) {
      expect(rulesFor(`<p>${phrase}</p>`), phrase).toContain('no-vague-failure');
    }
    expect(rulesFor('<p>If this keeps happening, try clearing your browser data.</p>')).toEqual([]);
  });

  it('passes copy written to the standard', () => {
    expect(rulesFor('<p>Reload the page to start it again. Your saved notes stay where they are.</p>')).toEqual(
      []
    );
    expect(rulesFor('<p>Storage is full. Export your notes, then delete a note to free space.</p>')).toEqual(
      []
    );
    expect(rulesFor('<h1>The notebook stopped</h1>')).toEqual([]);
  });

  it('names every rule it enforces, once', () => {
    expect(COPY_RULES.length).toBeGreaterThanOrEqual(4);
    const ids = COPY_RULES.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { id, rule } of COPY_RULES) {
      expect(rule.length, `${id} has no rule sentence`).toBeGreaterThan(20);
    }
    expect(ids).toContain('no-vague-failure');
  });
});

describe('reading the copy out of a file', () => {
  it('reads JSX text, the copy attributes and string literals', () => {
    const source = [
      '<div aria-label="Close the panel">',
      '  <h2>Export note</h2>',
      "  <button onClick={() => setError('Could not reach the server.')}>Retry</button>",
      '</div>',
    ].join('\n');
    const entries = extractCopy(source, { jsx: true });
    const texts = entries.map((entry) => entry.text);
    expect(texts).toContain('Close the panel');
    expect(texts).toContain('Export note');
    expect(texts).toContain('Could not reach the server.');
    expect(entries.find((entry) => entry.text === 'Export note').kind).toBe('jsx-text');
    expect(entries.find((entry) => entry.text === 'Close the panel').kind).toBe('aria-label');
  });

  it('keeps the line a string sits on', () => {
    const entries = extractCopy('const a = 1;\nconst b = 2;\nconst c = "Could not read the note.";', {
      jsx: false,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].line).toBe(3);
  });

  it('ignores comments, because a comment is not a message', () => {
    const source = [
      '// This used to say Something went wrong!',
      '/* An unexpected error occurred, before 2026-10-16. */',
      'const copy = "Saved the note.";',
    ].join('\n');
    const entries = extractCopy(source, { jsx: true });
    expect(entries.map((entry) => entry.text)).toEqual(['Saved the note.']);
    expect(stripComments(source)).not.toContain('Something went wrong');
  });

  it('does not read a utility-class list as copy', () => {
    expect(looksLikeClassList('flex items-center gap-2')).toBe(true);
    expect(looksLikeClassList('md:pl-52 xl:pl-56')).toBe(true);
    expect(looksLikeClassList('Something went wrong')).toBe(false);
    expect(looksLikeClassList('text-sm text-gray-400')).toBe(true);
  });

  it('leaves a bare token out of the inventory', () => {
    expect(looksLikeCopy('note-draft')).toBe(false);
    expect(looksLikeCopy('notes:read')).toBe(false);
    expect(looksLikeCopy('./components/Sidebar')).toBe(false);
    expect(looksLikeCopy('Saved')).toBe(false);
    expect(looksLikeCopy('Something went wrong')).toBe(true);
    expect(looksLikeCopy('Exported!')).toBe(true);
  });

  it('reads nothing out of a file that holds no copy', () => {
    expect(extractCopy('export const add = (a, b) => a + b;')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The gate. The rules above are worth nothing unless they run over the app's
// own source, so the sweep below reads every file and holds it to the standard.
// ---------------------------------------------------------------------------

const SRC_ROOT = join(process.cwd(), 'src');

const sourceFiles = (dir = SRC_ROOT) => {
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (!/\.(js|jsx)$/.test(name)) continue;
    if (/\.test\.(js|jsx)$/.test(name)) continue;
    if (COPY_AUDIT_SKIP.has(name)) continue;
    found.push(path);
  }
  return found;
};

const sweep = () => {
  const files = sourceFiles();
  const entries = [];
  const violations = [];
  for (const path of files) {
    const source = readFileSync(path, 'utf8');
    const found = extractCopy(source, { jsx: path.endsWith('.jsx') });
    entries.push(...found);
    for (const violation of auditCopy(found)) {
      violations.push(`${relative(SRC_ROOT, path)}:${violation.line} [${violation.rules.join(', ')}] ${violation.text}`);
    }
  }
  return { files, entries, violations };
};

describe('the message audit', () => {
  const { files, entries, violations } = sweep();

  it('reads the app, rather than passing because it found nothing', () => {
    // A gate that reads no files is decoration: this is the trap the coverage
    // thresholds fell into (a glob that matched nothing passed for a year).
    expect(files.length).toBeGreaterThan(50);
    expect(entries.length).toBeGreaterThan(500);
  });

  it('holds every string the app shows to the tone standard', () => {
    expect(violations, `copy that breaks the standard:\n${violations.join('\n')}`).toEqual([]);
  });
});
