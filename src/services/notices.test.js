import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  MAX_NOTICE_LENGTH,
  NOTICES,
  NOTICE_BANNED_WORDS,
  NOTICE_RULES,
  NOTICE_STEP_PHRASES,
  NOTICE_TONES,
  notice,
  noticeDuration,
  noticeText,
  noticeTone,
} from './notices';

/**
 * The tone standard is only real if it bites, so every notice in the catalog is
 * held to it here — including the ones whose text is built from numbers, which
 * are exercised with the sample arguments below.
 */
const SAMPLES = {
  imported: { imported: 3, skipped: 2 },
  backedUp: { count: 2 },
  nothingToRestore: { skipped: 2 },
  restored: { count: 2, when: '5 min ago' },
  folderConnected: { name: 'Dropbox notes' },
  aiErrorWithDetail: { status: 402, detail: 'Insufficient credits for this model.' },
  aiErrorGeneric: { status: 500 },
};

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}/u;
const BANNED = NOTICE_BANNED_WORDS;

const textOf = (key) => {
  const entry = NOTICES[key];
  return typeof entry.text === 'function' ? entry.text(SAMPLES[key]) : entry.text;
};

const keys = Object.keys(NOTICES);

describe('the notice catalog', () => {
  it('holds every entry with a tone from the standard', () => {
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) {
      expect(NOTICE_TONES, `${key} has an unknown tone`).toContain(NOTICES[key].tone);
      expect(typeof NOTICES[key].text, `${key} has no text`).toMatch(/string|function/);
    }
  });

  it('is frozen, so a call site cannot rewrite the copy', () => {
    expect(Object.isFrozen(NOTICES)).toBe(true);
  });

  it('exercises every notice that takes arguments', () => {
    const buildable = keys.filter((key) => typeof NOTICES[key].text === 'function');
    for (const key of buildable) {
      expect(SAMPLES[key], `${key} takes arguments and has no sample`).toBeDefined();
    }
    expect(buildable.length).toBeGreaterThan(0);
  });

  it('states at most two sentences: the fact, then the step', () => {
    for (const key of keys) {
      const text = textOf(key);
      const body = text.slice(0, -1); // without the final full stop
      const internalStops = body.match(/\. /g) || [];
      expect(internalStops.length, `${key} runs past two sentences: ${text}`).toBeLessThanOrEqual(1);
    }
  });

  it('reads as plain language: sentence case, one full stop, no shouting', () => {
    for (const key of keys) {
      const text = textOf(key);
      expect(text, `${key} does not start with a capital`).toMatch(/^[A-Z0-9]/);
      expect(text, `${key} does not end in a full stop`).toMatch(/\.$/);
      expect(text, `${key} carries an exclamation or question mark`).not.toMatch(/[!?]/);
      expect(text, `${key} carries an emoji`).not.toMatch(EMOJI);
      expect(text, `${key} has a double space or a stray edge`).toBe(text.replace(/\s+/g, ' ').trim());
    }
  });

  it('blames nobody and hypes nothing', () => {
    for (const key of keys) {
      const text = textOf(key).toLowerCase();
      for (const word of BANNED) {
        expect(text, `${key} says "${word}"`).not.toContain(word);
      }
    }
  });

  it('keeps every notice to one glance', () => {
    for (const key of keys) {
      const text = textOf(key);
      expect(text.length, `${key} is ${text.length} characters`).toBeLessThanOrEqual(
        MAX_NOTICE_LENGTH
      );
    }
  });

  it('gives every error a next step that can actually help', () => {
    const errors = keys.filter((key) => NOTICES[key].tone === 'error');
    expect(errors.length).toBeGreaterThan(8);
    for (const key of errors) {
      const text = textOf(key).toLowerCase();
      const step = NOTICE_STEP_PHRASES.find((phrase) => text.includes(phrase));
      expect(step, `${key} names no next step: ${textOf(key)}`).toBeDefined();
    }
  });

  it('documents the standard it enforces', () => {
    expect(NOTICE_RULES.length).toBeGreaterThanOrEqual(6);
    expect(NOTICE_RULES.join(' ')).toMatch(/two sentences/);
    expect(NOTICE_RULES.join(' ')).toMatch(/next step/);
  });
});

describe('reading a notice', () => {
  it('answers the message, the tone and the duration together', () => {
    expect(notice('backedUp', { count: 1 })).toEqual({
      message: 'Backed up 1 note.',
      tone: 'success',
      duration: 5000,
    });
  });

  it('carries the duration a message needs, and the default otherwise', () => {
    expect(noticeDuration('conflictDetected')).toBe(8000);
    expect(noticeDuration('noteAlreadyOpen')).toBe(5000);
  });

  it('reads a fixed message without arguments', () => {
    expect(noticeText('storageBlocked')).toMatch(/^This browser is blocking storage\./);
    expect(noticeTone('storageBlocked')).toBe('error');
  });

  it('counts in words a person would use', () => {
    expect(noticeText('backedUp', { count: 1 })).toBe('Backed up 1 note.');
    expect(noticeText('backedUp', { count: 3 })).toBe('Backed up 3 notes.');
    expect(noticeText('imported', { imported: 1, skipped: 0 })).toBe('Imported 1 note.');
    expect(noticeText('imported', { imported: 4, skipped: 1 })).toBe(
      'Imported 4 notes. Skipped 1 already here.'
    );
  });

  it('fails loudly on a key that does not exist', () => {
    expect(() => noticeText('nope')).toThrow(/Unknown notice "nope"/);
    expect(() => noticeTone('nope')).toThrow(/Unknown notice "nope"/);
  });
});

// ---------------------------------------------------------------------------
// The system is one system only if a call site cannot bypass it. These two
// tests read the source: a notice call may name a catalog key, never prose.
// ---------------------------------------------------------------------------

// `import.meta.url` is a jsdom URL under this environment, so the project root
// comes from the working directory the suite is run in.
const SRC_ROOT = join(process.cwd(), 'src');
const NOTICE_CALL = /(?:showToast|showNotice|onNotice)(?:\?\.)?\(/g;
const KEY_REFERENCE = /(?:noticeText|noticeTone|noticeDuration|notice)\(\s*'([A-Za-z0-9]+)'/g;
const ANY_QUOTED_WORD = /'([A-Za-z][A-Za-z0-9]*)'/g;

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
    if (name === 'notices.js') continue;
    found.push(path);
  }
  return found;
};

/** The first argument of a call, from the index of its opening bracket. */
const firstArgument = (text, openIndex) => {
  let depth = 0;
  let quote = null;
  let argument = '';
  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      argument += char;
      if (char === '\\') {
        argument += text[i + 1] ?? '';
        i += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      argument += char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth += 1;
    if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
    if (char === ',' && depth === 1) break;
    if (depth >= 1) argument += char;
  }
  return argument.trim();
};

describe('one notice system', () => {
  it('is not bypassed: no call site passes prose instead of a key', () => {
    const offenders = [];
    for (const path of sourceFiles()) {
      const text = readFileSync(path, 'utf8');
      NOTICE_CALL.lastIndex = 0;
      let match = NOTICE_CALL.exec(text);
      while (match) {
        const argument = firstArgument(text, match.index + match[0].length - 1);
        if (/^['"`]/.test(argument)) {
          const key = argument.slice(1, -1);
          if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key) || !NOTICES[key]) {
            offenders.push(`${relative(SRC_ROOT, path)}: ${argument.slice(0, 60)}`);
          }
        }
        match = NOTICE_CALL.exec(text);
      }
    }
    expect(offenders, `notice copy written inline:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('names only keys that exist, and leaves no copy unused', () => {
    const named = new Set();
    const referenced = new Set();
    for (const path of sourceFiles()) {
      const text = readFileSync(path, 'utf8');
      NOTICE_CALL.lastIndex = 0;
      let match = NOTICE_CALL.exec(text);
      while (match) {
        const argument = firstArgument(text, match.index + match[0].length - 1);
        if (/^['"`]/.test(argument)) named.add(argument.slice(1, -1));
        match = NOTICE_CALL.exec(text);
      }
      KEY_REFERENCE.lastIndex = 0;
      let reference = KEY_REFERENCE.exec(text);
      while (reference) {
        named.add(reference[1]);
        reference = KEY_REFERENCE.exec(text);
      }
      // A key can also be chosen by a branch (`saved ? 'localDraftSaved' : …`),
      // so the rot check reads every quoted word and keeps the ones that are
      // catalog keys.
      ANY_QUOTED_WORD.lastIndex = 0;
      let word = ANY_QUOTED_WORD.exec(text);
      while (word) {
        if (NOTICES[word[1]]) referenced.add(word[1]);
        word = ANY_QUOTED_WORD.exec(text);
      }
    }
    for (const key of named) referenced.add(key);

    const unknown = [...named].filter((key) => !NOTICES[key]);
    expect(unknown, `keys that do not exist: ${unknown.join(', ')}`).toEqual([]);

    const unused = Object.keys(NOTICES).filter((key) => !referenced.has(key));
    expect(unused, `copy nobody shows: ${unused.join(', ')}`).toEqual([]);
  });
});
