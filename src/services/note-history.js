/**
 * Note history: content snapshots per note.
 *
 * A snapshot is written every time the app reports the note as saved, so a bad
 * edit is recoverable across sessions. Snapshots live in browser storage under
 * `note-versions:<noteId>`; only significant changes are kept, and the newest
 * 50 are retained.
 */

export const NOTE_HISTORY_LIMIT = 50;

/**
 * Announced after the save pipeline records a snapshot, so a History panel that
 * is open while the note is edited does not go on stating a count that has
 * stopped being true. Same shape as the agent-name setting: the service that
 * knows, says so on `window`, and the panel subscribes.
 */
export const NOTE_VERSIONS_EVENT = 'canonote:note-versions-changed';

const notifyNoteVersionsChanged = (noteId) => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(NOTE_VERSIONS_EVENT, { detail: { noteId } }));
};

// A save becomes a version if it changes the note meaningfully (50+ characters,
// or 10% of the note), or if a minute has passed since the last snapshot — so
// a long editing session still gets versioned while typing does not create a
// version per keystroke. Note that a rewrite of the same length is caught by
// the time rule, not by the size rule.
const MIN_CHAR_CHANGE = 50;
const MIN_PERCENT_CHANGE = 0.1;
const MIN_INTERVAL_MS = 60 * 1000;

export const noteHistoryKey = (storage, noteId) =>
  storage?.scopedKey ? storage.scopedKey(`note-versions:${noteId}`) : null;

const isSignificantChange = (nextContent, previous) => {
  if (!previous) return true;
  if (nextContent === previous.content) return false;
  const charDiff = Math.abs(nextContent.length - previous.content.length);
  const maxLen = Math.max(nextContent.length, previous.content.length, 1);
  const changedInSize = charDiff >= MIN_CHAR_CHANGE || charDiff / maxLen >= MIN_PERCENT_CHANGE;
  const minuteSinceLast = Date.now() - (previous.timestamp || 0) >= MIN_INTERVAL_MS;
  return changedInSize || minuteSinceLast;
};

/**
 * Newest first, plus whether the store refused the read.
 *
 * The panel needs to tell "this note has no versions" from "the browser would
 * not let me look" — the first is an empty state, the second is an error, and
 * an error shown as an empty state is a lie. The save pipeline only wants the
 * versions, so `readNoteVersions` below stays the forgiving form.
 *
 * Unparseable history is treated as none, never as an error.
 */
export const readNoteVersionsResult = async (storage, noteId) => {
  const key = noteHistoryKey(storage, noteId);
  if (!key) return { versions: [], error: null };

  let saved;
  try {
    saved = await storage.get(key);
  } catch (error) {
    return { versions: [], error };
  }

  if (!saved?.value) return { versions: [], error: null };
  try {
    const parsed = JSON.parse(saved.value);
    if (!Array.isArray(parsed)) return { versions: [], error: null };
    return {
      versions: parsed
        .filter((version) => version && typeof version.content === 'string')
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)),
      error: null,
    };
  } catch {
    return { versions: [], error: null };
  }
};

export const readNoteVersions = async (storage, noteId) =>
  (await readNoteVersionsResult(storage, noteId)).versions;

export const writeNoteVersions = async (storage, noteId, versions) => {
  const key = noteHistoryKey(storage, noteId);
  if (!key) return false;
  await storage.set(key, JSON.stringify(versions.slice(0, NOTE_HISTORY_LIMIT)));
  return true;
};

/**
 * Record a snapshot of `content`. Returns true when a version was written.
 * `force` skips the significance check (used when restoring, so the content
 * that is about to be replaced is never lost).
 */
export const recordNoteVersion = async (storage, noteId, content, { force = false } = {}) => {
  if (!storage || !noteId || typeof content !== 'string' || !content.trim()) return false;

  const versions = await readNoteVersions(storage, noteId);
  const previous = versions[0] || null;
  if (previous && content === previous.content) return false;
  if (!force && !isSignificantChange(content, previous)) return false;

  const version = {
    id: `v-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    content,
    timestamp: Date.now(),
    wordCount: content.split(/\s+/).filter((word) => word.length > 0).length,
    charCount: content.length,
  };

  await writeNoteVersions(storage, noteId, [version, ...versions]);
  notifyNoteVersionsChanged(noteId);
  return true;
};
