/**
 * Rotating local backups — the notebook's own safety net.
 *
 * The notebook keeps one copy of every note in one browser store, and the
 * failure worth guarding against is the quiet one: the note list comes back
 * empty (a lost cache, a cleared store, a browser that dropped the data) and
 * the text is gone with no second place to look. So the app keeps the newest
 * few *whole-notebook* snapshots in the same store as the notes — written on
 * demand ("Back up now") and once a day on their own — and rotation caps how
 * many: three snapshots is enough to survive "the newest backup was taken after
 * the damage", and few enough that the backups cannot be what fills the quota.
 *
 * A backup never replaces anything. Restoring writes back only the notes the
 * notebook no longer has and reports what it did, because a backup that could
 * silently overwrite newer notes would be a second way to lose work. Backup
 * keys live outside the note key space (`local:notebook-backup:*`) so the
 * orphan scan in `useNotes` cannot mistake one for a note.
 */
import { getBrowserStorage } from './browser-storage';
import { describeStorageFailure } from './storage-failure';
import { noticeText, noticeTone } from './notices';

export const BACKUP_INDEX_KEY = 'local:notebook-backups';
export const BACKUP_KEY_PREFIX = 'local:notebook-backup:';
export const MAX_LOCAL_BACKUPS = 3;
export const BACKUP_SCHEMA_VERSION = 1;
// A day is the rotation's clock: the daily session that keeps a notebook open
// writes one snapshot, so the three kept snapshots span roughly three days.
export const BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const backupStorageKey = (id) => `${BACKUP_KEY_PREFIX}${id}`;

const normaliseEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  const createdAt = Number.isFinite(entry.createdAt) ? entry.createdAt : null;
  if (!id || !createdAt) return null;
  return {
    id,
    createdAt,
    noteCount: Number.isFinite(entry.noteCount) ? entry.noteCount : 0,
    bytes: Number.isFinite(entry.bytes) ? entry.bytes : 0,
  };
};

const newestFirst = (entries) =>
  entries.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);

/**
 * The backup index, newest first. A corrupt or unreadable index reads as "no
 * backups" rather than throwing: a broken index must not take the notebook
 * down with it, and the snapshots themselves stay on disk.
 */
export const readBackupIndex = (store = getBrowserStorage()) => {
  if (!store) return [];
  let raw = null;
  try {
    raw = store.getItem(BACKUP_INDEX_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return newestFirst((Array.isArray(parsed) ? parsed : []).map(normaliseEntry));
};

const writeBackupIndex = (store, index) => {
  try {
    store.setItem(BACKUP_INDEX_KEY, JSON.stringify(index));
    return true;
  } catch {
    return false;
  }
};

/** The snapshot itself, or null when it is missing or unreadable. */
export const readBackup = (id, store = getBrowserStorage()) => {
  if (!store || !id) return null;
  let raw = null;
  try {
    raw = store.getItem(backupStorageKey(id));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.notes)) return null;
    return parsed;
  } catch {
    return null;
  }
};

/**
 * Keep the newest `MAX_LOCAL_BACKUPS` entries and delete the snapshots that
 * fall out of the window — the rotation. Returns the index that was kept.
 */
export const pruneBackupIndex = (entries = [], store = getBrowserStorage()) => {
  const sorted = newestFirst((Array.isArray(entries) ? entries : []).map(normaliseEntry));
  const kept = sorted.slice(0, MAX_LOCAL_BACKUPS);
  const dropped = sorted.slice(MAX_LOCAL_BACKUPS);
  if (store) {
    for (const entry of dropped) {
      try {
        store.removeItem(backupStorageKey(entry.id));
      } catch {
        // A snapshot that will not delete is not worth failing the backup for.
      }
    }
  }
  return kept;
};

/**
 * Should the app take a backup on its own? Only when the newest one has gone
 * stale, so opening the notebook five times in a morning writes one snapshot,
 * not five.
 */
export const shouldWriteBackup = (index = [], now = Date.now(), options = {}) => {
  const { maxAgeMs = BACKUP_MAX_AGE_MS } = options;
  const entries = newestFirst((Array.isArray(index) ? index : []).map(normaliseEntry));
  if (entries.length === 0) return true;
  return now - entries[0].createdAt >= maxAgeMs;
};

/**
 * Write one snapshot of the whole notebook and rotate. `readContent(note)`
 * belongs to the caller: it knows the seam the notes are actually stored in.
 * Returns `{ ok, entry, index }`, or `{ ok: false, message }` with the sentence
 * to show when the browser refused the write or there is nothing to save.
 */
export const writeLocalBackup = async ({
  notes = [],
  readContent,
  store = getBrowserStorage(),
  now = Date.now(),
}) => {
  if (!store) {
    return { ok: false, message: noticeText('backupBlocked'), tone: noticeTone('backupBlocked') };
  }
  if (!notes.length) {
    return { ok: false, message: noticeText('backupNothing'), tone: noticeTone('backupNothing') };
  }

  const snapshotNotes = [];
  for (const note of notes) {
    let content = '';
    try {
      content = (await readContent?.(note)) ?? '';
    } catch {
      content = '';
    }
    snapshotNotes.push({
      id: note.id,
      title: note.title || 'Untitled',
      updated: Number.isFinite(note.updated) ? note.updated : now,
      isPinned: Boolean(note.isPinned),
      folder: note.folder || 'private',
      content: typeof content === 'string' ? content : '',
    });
  }

  const id = String(now);
  const payload = JSON.stringify({
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: now,
    notes: snapshotNotes,
  });

  try {
    store.setItem(backupStorageKey(id), payload);
  } catch (error) {
    return {
      ok: false,
      message: describeStorageFailure(error),
      tone: noticeTone('saveFailed'),
    };
  }

  const entry = { id, createdAt: now, noteCount: snapshotNotes.length, bytes: payload.length };
  const index = pruneBackupIndex([entry, ...readBackupIndex(store)], store);
  writeBackupIndex(store, index);
  return { ok: true, entry, index };
};

/**
 * Restore a snapshot into the notebook: every note the notebook no longer has
 * is written back, through the same primitives a created note uses, and the
 * cache row is added so the note is listed and searchable like any other.
 * Notes that are still present are left alone and counted as skipped.
 */
export const restoreLocalBackup = async ({
  snapshot,
  currentNotes = [],
  storage,
  now = Date.now(),
}) => {
  if (!snapshot || !Array.isArray(snapshot.notes) || !storage?.noteStorageKey) {
    return { restored: [], skipped: 0 };
  }

  const known = new Set(currentNotes.map((note) => note?.id).filter(Boolean));
  const restored = [];
  let skipped = 0;

  for (const note of snapshot.notes) {
    if (!note?.id || known.has(note.id)) {
      skipped += 1;
      continue;
    }
    await window.storage.set(storage.noteStorageKey(note.id), note.content ?? '');
    restored.push({
      id: note.id,
      note_id: note.id,
      title: note.title || 'Untitled',
      updated: Number.isFinite(note.updated) ? note.updated : now,
      isPinned: Boolean(note.isPinned),
      folder: note.folder || 'private',
      revision: null,
    });
  }

  if (restored.length > 0) {
    const cacheKey = storage.scopedKey?.('notes-cache');
    if (cacheKey) {
      await window.storage.set(cacheKey, JSON.stringify([...restored, ...currentNotes]));
    }
  }

  return { restored, skipped };
};
