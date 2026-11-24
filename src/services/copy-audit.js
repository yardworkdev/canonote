/**
 * The message audit — the tone standard, applied to every string the reader sees.
 *
 * Slice 4's last item: *a message audit with a tone standard, and nothing vague
 * where a fact is available*. The catalog (`src/services/notices.js`) is the
 * copy the app says out loud, and `notices.test.js` holds it to the seven rules.
 * Everything else the reader reads — a panel's empty state, a dialog's
 * confirmation, a status line, an error boundary's whole page, an attribute a
 * screen reader announces — was written where it is shown, and nobody could
 * review it as a body, count it or test it. The audit found what the catalog's
 * standard had never reached:
 *
 * - two success messages that shouted (`Exported!`, `Copied to clipboard!`);
 * - an error boundary whose page said `Something went wrong` and `An unexpected
 *   error occurred` while it held the error's own message in a box two lines
 *   below — the fact was right there and the copy did not state it;
 * - the same page's help line telling the reader to *clear their browser data*,
 *   which is where a local-first notebook keeps their notes: advice that cannot
 *   be followed, in the class of the `please retry` a blocked store cannot honour;
 * - a print document carrying an emoji, and a panel whose empty states said
 *   nothing the reader could act on.
 *
 * So the standard is a gate over the source now. `extractCopy` reads the strings
 * a reader can see out of a file — JSX text, the attributes that carry copy, and
 * string literals — `auditCopy` holds each one to `COPY_RULES`, and
 * `copy-audit.test.js` runs both over every file in `src/` and fails the unit
 * gate on a violation. `scripts/audit-copy.mjs` prints the same inventory as a
 * report, so the audit is a thing that can be re-run and read rather than a
 * session someone remembers having done.
 *
 * The catalog is deliberately out of the sweep: it is held to the stricter
 * notice standard by its own suite, and it exports the rule vocabulary itself
 * (`NOTICE_BANNED_WORDS` carries the words in order to ban them), so scanning it
 * would report the standard as a violation of itself.
 */

// The extension is explicit so `node scripts/audit-copy.mjs` can read this
// module outside the bundler; every other import in the app is extensionless.
import { NOTICE_BANNED_WORDS } from './notices.js';

/** An icon is a component, not a character in a sentence (BRAND.md). */
export const COPY_EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}/u;

/**
 * The two files the sweep leaves out, both of them the standard's own
 * vocabulary: the notice catalog is held to the stricter notice standard by its
 * own suite and exports `NOTICE_BANNED_WORDS` in order to ban them, and this
 * module exports the rules and the phrases. Scanning either would report the
 * standard as a violation of itself.
 */
export const COPY_AUDIT_SKIP = new Set(['notices.js', 'copy-audit.js']);

/**
 * Words the app does not use: blame, apology and hype. The same list the notice
 * catalog is written against, minus `just`: the notebook says "just now" about a
 * timestamp, which is a fact about time and not the filler the catalog bans in a
 * sentence. One vocabulary, one documented exception.
 */
export const COPY_BANNED_WORDS = NOTICE_BANNED_WORDS.filter((word) => word.trim() !== 'just');

/**
 * Phrases that state a failure without the fact the app is holding. Each one was
 * found in the app: a boundary that renders the error's own message and still
 * says "Something went wrong" is telling the reader less than it knows.
 */
export const COPY_VAGUE_PHRASES = [
  'something went wrong',
  'something has gone wrong',
  'something bad happened',
  'an unexpected error occurred',
  'an error occurred',
  'an error has occurred',
  'contact support',
];

/** The rules, each with the id a violation reports. Read by the test and the docs. */
export const COPY_RULES = [
  {
    id: 'no-shouting',
    rule: 'no exclamation mark in a string the reader sees: the fact, stated plainly',
  },
  {
    id: 'no-emoji',
    rule: 'no emoji: an icon is a component, not a character in the copy',
  },
  {
    id: 'no-blame',
    rule: 'no blame and no apology: the catalog\u2019s banned words, one vocabulary for both surfaces',
  },
  {
    id: 'no-vague-failure',
    rule: 'a failure names the fact the app has, never "something went wrong" or advice nobody can follow',
  },
];

const RULE_IDS = COPY_RULES.map(({ id }) => id);

/** The attributes that carry copy to the reader (including a screen reader). */
export const COPY_ATTRIBUTES = ['aria-label', 'aria-description', 'title', 'placeholder', 'alt'];

const escapeForPattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A banned word matches at a word start, so `apolog` catches "apology" and
 * "just" does not match "adjust". Word-start is the boundary the catalog's own
 * list needs; a trailing boundary would break the stems in it.
 */
const BANNED_WORD_PATTERNS = COPY_BANNED_WORDS.map(
  (word) => new RegExp(`\\b${escapeForPattern(word.trim())}`, 'i')
);

/** Code punctuation a fragment carries when it is not text the reader sees. */
const CODE_SHAPES = [
  /[;={}]/,
  /&&/,
  /=>/,
  /^[a-z0-9]+(-[a-z0-9]+)+$/, // kebab-case: note-draft, aria-modal
  /^[a-z0-9]+([._/:][a-z0-9]+)+$/, // keys and paths: notes:read, api/agent
  /^[A-Z][A-Za-z0-9]*$/, // one capitalised token: Enter, Escape, Retry
  /^[a-z][A-Za-z0-9]*$/, // one lowercase token: markdown, exported
  /^\.{0,2}\/[A-Za-z]/, // a path: ./components/Sidebar, /app
  /^[^a-zA-Z]*$/, // digits and punctuation only
];

const CLASS_TOKEN = /^[a-z0-9]+(?:[-:[\]/.,%()#][a-z0-9%.[\]()#,]*)*$/i;
const CLASS_MARKER = /[-:/[\]%#]/;

/**
 * A utility-class list is not copy: `flex items-center gap-2` is a class string
 * the reader never sees, and reading it as a message would put a hundred of them
 * in the inventory and drown the ones that matter. The test is deliberately
 * narrow — every word shaped like a class token, most of them carrying a class
 * marker (`-`, `:`, `/`, `[`), and no shouting punctuation anywhere — so
 * `Something went wrong` is never mistaken for one.
 */
export const looksLikeClassList = (text) => {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  if (/[!?]/.test(text)) return false;
  if (!words.every((word) => CLASS_TOKEN.test(word))) return false;
  const marked = words.filter((word) => CLASS_MARKER.test(word)).length;
  return marked * 2 >= words.length;
};

/**
 * A candidate is copy when it reads as words rather than as a token: an
 * identifier, a class name, a key or a path is not a sentence and is not
 * audited. The rules are about sentences and phrases — one-word labels are
 * neither vague nor shouty.
 */
export const looksLikeCopy = (text) => {
  const trimmed = text.trim();
  if (!/[a-zA-Z]/.test(trimmed)) return false;
  if (!/\s/.test(trimmed) && !/[.!?:\u2026]/.test(trimmed)) return false;
  if (looksLikeClassList(trimmed)) return false;
  return !CODE_SHAPES.some((shape) => shape.test(trimmed));
};

/**
 * Comments are removed before anything is read, because a comment that quotes
 * the copy ("this used to say Something went wrong") is documentation, not a
 * message. Line numbers are preserved so a violation can be opened.
 */
export const stripComments = (source) => {
  let out = '';
  let quote = null;
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (quote) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (char === quote) quote = null;
      i += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    out += char;
    i += 1;
  }
  return out;
};

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

const unescapeLiteral = (value) =>
  value
    .replace(/\\n/g, ' ')
    .replace(/\\(['"`\\])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

const attributePattern = new RegExp(
  `\\b(${COPY_ATTRIBUTES.join('|')})\\s*=\\s*("([^"]*)"|'([^']*)')`,
  'g'
);
const literalPattern = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g;
const jsxTextPattern = />([^<>{}]{2,})</g;

/**
 * Every string a reader can see in one file, as `{ line, kind, text }`.
 * `kind` is `jsx-text`, an attribute name, or `literal` — the report keeps the
 * distinction so a finding can be judged in the context it is shown in.
 */
export const extractCopy = (source, { jsx = false } = {}) => {
  const code = stripComments(source);
  const found = new Map();
  const add = (line, kind, raw) => {
    const text = unescapeLiteral(raw);
    if (!looksLikeCopy(text)) return;
    const key = `${line}:${kind}:${text}`;
    if (found.has(key)) return;
    found.set(key, { line, kind, text });
  };

  if (jsx) {
    jsxTextPattern.lastIndex = 0;
    let match = jsxTextPattern.exec(code);
    while (match) {
      add(lineAt(code, match.index), 'jsx-text', match[1]);
      match = jsxTextPattern.exec(code);
    }
  }

  attributePattern.lastIndex = 0;
  let attribute = attributePattern.exec(code);
  while (attribute) {
    add(lineAt(code, attribute.index), attribute[1], attribute[3] ?? attribute[4] ?? '');
    attribute = attributePattern.exec(code);
  }

  literalPattern.lastIndex = 0;
  let literal = literalPattern.exec(code);
  while (literal) {
    add(lineAt(code, literal.index), 'literal', literal[1] ?? literal[2] ?? '');
    literal = literalPattern.exec(code);
  }

  return [...found.values()].sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
};

/** The rule ids one string breaks. An empty list means it passes. */
export const auditEntry = ({ text }) => {
  const violations = [];
  if (text.includes('!')) violations.push('no-shouting');
  if (COPY_EMOJI.test(text)) violations.push('no-emoji');
  if (BANNED_WORD_PATTERNS.some((pattern) => pattern.test(text))) violations.push('no-blame');
  const lower = text.toLowerCase();
  if (COPY_VAGUE_PHRASES.some((phrase) => lower.includes(phrase))) {
    violations.push('no-vague-failure');
  }
  return violations.filter((id) => RULE_IDS.includes(id));
};

/** Every violation in a file's copy, as `{ line, kind, text, rules }`. */
export const auditCopy = (entries) =>
  entries
    .map((entry) => ({ ...entry, rules: auditEntry(entry) }))
    .filter(({ rules }) => rules.length > 0);
