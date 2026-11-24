import crypto from 'node:crypto';

/**
 * Writing, for a notebook with two kinds of author.
 *
 * The reliable primitive is append: two writers appending to the same note cannot
 * destroy each other's work, so an agent never needs to hold a lock and never needs
 * to ask permission to add something. Replacement is the dangerous one, and it is
 * guarded by the revision it was based on.
 *
 * Everything here is pure: no clock, no network, no storage. The handlers own those,
 * which makes every rule below testable without a database.
 */

export function revisionOf(body) {
  return crypto.createHash('sha256').update(String(body ?? '')).digest('hex').slice(0, 16);
}

/** Join two pieces of markdown without inventing or eating blank lines. */
export function joinBlocks(a, b) {
  const left = String(a ?? '').replace(/\s+$/, '');
  const right = String(b ?? '').replace(/^\s+/, '');
  if (!left) return right;
  if (!right) return left;
  return `${left}\n\n${right}`;
}

export function createNote({ id, title, body = '', author, at }) {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) return { ok: false, status: 400, error: 'title is required' };
  const content = String(body || '');
  return {
    ok: true,
    status: 201,
    note: {
      id,
      title: cleanTitle,
      body: content,
      rev: revisionOf(content),
      created: at,
      updated: at,
      createdBy: author,
      updatedBy: author,
      contributors: [author],
      folder: author === 'agent' ? 'agent' : 'private',
      agentAccess: true,
      // Always present, even when empty: a client should not get a different key
      // set for a note that happens to have no tags.
      tags: [],
      words: countWords(content),
    },
  };
}

/**
 * Append is unconditional on purpose: it is the one operation that stays correct
 * when a person is typing in the same note at the same time.
 */
export function appendToNote(note, addition, { author, at }) {
  const text = String(addition ?? '');
  if (!text.trim()) return { ok: false, status: 400, error: 'nothing to append' };
  const body = joinBlocks(note.body, text);
  return {
    ok: true,
    status: 200,
    note: {
      ...note,
      body,
      rev: revisionOf(body),
      updated: at,
      updatedBy: author,
      contributors: mergeAuthors(note, author),
      words: countWords(body),
    },
  };
}

/**
 * Replace requires the revision it was based on. A stale write is refused with the
 * current revision attached, so the caller can merge and retry instead of guessing.
 */
export function replaceNote(note, body, { ifRev, author, at }) {
  if (!ifRev) return { ok: false, status: 428, error: 'ifRev is required for a replace', rev: note.rev };
  if (ifRev !== note.rev) return { ok: false, status: 409, error: 'stale revision', rev: note.rev, body: note.body };
  const text = String(body ?? '');
  return {
    ok: true,
    status: 200,
    note: {
      ...note,
      body: text,
      rev: revisionOf(text),
      updated: at,
      updatedBy: author,
      contributors: mergeAuthors(note, author),
      words: countWords(text),
    },
  };
}

export function countWords(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

/** A note the person and the agent both worked on should say so. */
export function mergeAuthors(note, author) {
  const previous = Array.isArray(note.contributors) ? note.contributors : [note.createdBy].filter(Boolean);
  return author && !previous.includes(author) ? [...previous, author] : [...previous];
}

export function authors(note) {
  if (Array.isArray(note.contributors) && note.contributors.length) return [...note.contributors];
  return Array.from(new Set([note.createdBy, note.updatedBy].filter(Boolean)));
}
