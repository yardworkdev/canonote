/**
 * The note journal — how a save survives the tab being killed mid-save.
 *
 * The notebook saves on a debounce: a keystroke writes a *draft record*
 * (`<user>:note-draft:<id>`) and the save that follows commits the note content
 * and consumes the record. The record is therefore a write-ahead journal entry:
 * written before the thing it describes, cleared only once that thing has
 * landed — and if the tab dies in between, the entry is still there.
 *
 * Recovery on open replays every entry that is still present: the note content
 * is written back, the row reappears in the list with its text, and only then is
 * the entry consumed. Replay is idempotent — an entry whose content already
 * matches the committed note is simply cleared — so running it on every open
 * cannot duplicate or resurrect anything. Two things are deliberately not
 * replayed: a note deleted on this device (a tombstone must stay a tombstone),
 * an entry the notebook already has newer state for (a second tab may have saved
 * after this record was written), and an entry whose text the note already holds
 * *and more of* — that record is an earlier state of the same note that a save
 * overtook, and replaying it would truncate the note.
 *
 * `commitNoteContent` is the one place note content is written, so the order the
 * journal depends on — content first, consumed record after — is decided once.
 */
import { titleFromMarkdown } from '../utils/markdown';

export const DRAFT_KEY_PREFIX = 'note-draft:';
export const DRAFT_SCHEMA_VERSION = 1;

export const draftKeySuffix = (noteId) => `${DRAFT_KEY_PREFIX}${noteId}`;

export const draftKeyFor = (scopedKey, noteId) =>
  typeof scopedKey === 'function' ? scopedKey(draftKeySuffix(noteId)) : null;

/** The record the journal keeps for a note whose text has not been committed. */
export const serializeDraft = ({
  noteId,
  content,
  baseRevision = null,
  updatedAt = Date.now(),
}) =>
  JSON.stringify({
    schemaVersion: DRAFT_SCHEMA_VERSION,
    noteId,
    content: typeof content === 'string' ? content : '',
    baseRevision,
    updatedAt,
    dirty: true,
  });

/**
 * A record the journal can act on, or null. A record for a different note (a
 * key reused after a delete, say) or one whose content is not a string is not
 * something to write into the notebook.
 */
export const parseDraft = (raw, expectedNoteId = null) => {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.content !== 'string') return null;
  if (expectedNoteId && parsed.noteId !== expectedNoteId) return null;
  return {
    noteId: typeof parsed.noteId === 'string' ? parsed.noteId : expectedNoteId,
    content: parsed.content,
    baseRevision: typeof parsed.baseRevision === 'string' ? parsed.baseRevision : null,
    updatedAt: Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : null,
  };
};

/** `<user>:note-draft:<noteId>` → `<noteId>`; anything else is null. */
export const noteIdFromDraftKey = (key, userId) => {
  if (typeof key !== 'string' || !userId) return null;
  const prefix = `${userId}:${DRAFT_KEY_PREFIX}`;
  if (!key.startsWith(prefix)) return null;
  const noteId = key.slice(prefix.length);
  return noteId.length > 0 ? noteId : null;
};

/**
 * What recovery should do, decided without touching a store: `restore` is the
 * list of note rows to write back (existing metadata merged where the notebook
 * still has the row), `clear` is the records that are consumed and must go.
 */
export const planJournalReplay = ({
  records = [],
  notesById = new Map(),
  isDeleted = () => false,
  storedContentFor = () => null,
  now = Date.now(),
} = {}) => {
  const restore = [];
  const clear = [];

  for (const record of records) {
    const { key, noteId, draft } = record || {};
    if (!key || !noteId) continue;
    if (!draft || draft.content.trim().length === 0) {
      // Nothing to lose, or nothing readable: the record is not worth keeping.
      clear.push(key);
      continue;
    }
    if (isDeleted(noteId)) {
      clear.push(key);
      continue;
    }
    const storedContent = storedContentFor(noteId);
    if (
      typeof storedContent === 'string' &&
      storedContent.length > draft.content.length &&
      storedContent.startsWith(draft.content)
    ) {
      // The note already holds this text and more, so the record is an earlier
      // state of the same note that a save overtook — and writing it back would
      // truncate the note. A record can only be a strict prefix of committed
      // content by being older: text reaches the store by a commit, and the
      // commit that made the note longer had more text than this record does.
      // The timestamp rule below cannot see this, because the record is often
      // the newer of the two.
      clear.push(key);
      continue;
    }
    const existing = notesById.get(noteId) || null;
    if (existing && Number.isFinite(existing.updated) && existing.updated >= draft.updatedAt) {
      // The notebook already holds newer state for this note — the record is a
      // leftover from a save another tab (or this one) committed afterwards.
      clear.push(key);
      continue;
    }
    const title = titleFromMarkdown(draft.content) || existing?.title || 'Untitled';
    restore.push({
      ...(existing || {}),
      id: noteId,
      note_id: noteId,
      title,
      updated: draft.updatedAt || now,
      isPinned: Boolean(existing?.isPinned),
      folder: existing?.folder || 'private',
      // The row's revision belongs to the server's text, not this record's. A
      // recovered draft is the text as of its own base revision, so claiming the
      // newer one lets it save over whatever that revision contained — on
      // 2026-11-18 that deleted an agent's paragraph with no conflict at all.
      revision: draft.baseRevision ?? null,
      content: draft.content,
      recovered: true,
    });
    clear.push(key);
  }

  return { restore, clear };
};

const writeThrough = async (store, entries, remove) => {
  if (typeof store?.setMany === 'function') {
    await store.setMany(entries, { remove });
    return;
  }
  for (const [key, value] of entries) await store.set(key, value);
  for (const key of remove) await store.delete(key);
};

/**
 * The one writer of note content. `clearDraft` decides what happens to the
 * journal record this content supersedes: `'conditional'` (the default) consumes
 * it only when it still holds exactly this text, so a keystroke that arrived
 * while the save was in flight keeps its own record and its own chance to be
 * replayed; `'always'` is for adopting content the draft has been superseded by;
 * `'never'` leaves the record alone.
 */
export const commitNoteContent = async ({
  store,
  noteId,
  noteKey,
  draftKey = null,
  contentToSave,
  clearDraft = 'conditional',
}) => {
  if (!store || !noteKey) return false;
  const remove = [];
  if (draftKey && clearDraft !== 'never') {
    if (clearDraft === 'always') {
      remove.push(draftKey);
    } else {
      const raw = (await store.get?.(draftKey))?.value ?? null;
      const record = parseDraft(raw, noteId);
      // The record goes when the commit holds its text — or more of it: a record
      // the commit has overtaken is an earlier state of the same note, and one
      // left behind is a record that can later be replayed over newer text.
      const superseded =
        record && (record.content === contentToSave || contentToSave.startsWith(record.content));
      if (!record || superseded) remove.push(draftKey);
    }
  }
  await writeThrough(store, [[noteKey, contentToSave]], remove);
  return true;
};

/** Every key/value pair the store holds, through the seam. */
export const readStoreEntries = async (store) => {
  if (!store) return [];
  try {
    if (typeof store.entries === 'function') {
      const entries = await store.entries();
      return Array.isArray(entries) ? entries : [];
    }
    if (typeof store.keys === 'function') {
      const keys = await store.keys();
      const pairs = [];
      for (const key of Array.isArray(keys) ? keys : []) {
        const stored = await store.get(key);
        if (typeof stored?.value === 'string') pairs.push([key, stored.value]);
      }
      return pairs;
    }
  } catch {
    return [];
  }
  return [];
};

/**
 * Replay the journal: write back every interrupted save, consume what was
 * replayed, and report what happened so the notebook can add the recovered rows
 * to its list and the session log can say a save was recovered rather than lost.
 */
export const replayJournal = async ({
  store,
  userId,
  notes = [],
  isDeleted = () => false,
  noteKeyFor,
  now = Date.now(),
} = {}) => {
  if (!store || !userId) return { restored: [], cleared: 0, discarded: 0 };
  const entries = await readStoreEntries(store);
  const records = [];
  let discarded = 0;

  for (const [key, value] of entries) {
    const noteId = noteIdFromDraftKey(key, userId);
    if (!noteId) continue;
    const draft = parseDraft(value, noteId);
    if (!draft) discarded += 1;
    records.push({ key, noteId, draft });
  }

  if (records.length === 0) return { restored: [], cleared: 0, discarded };

  const notesById = new Map(notes.map((note) => [note?.id, note]).filter(([id]) => Boolean(id)));
  const storedEntries = new Map(entries);
  const plan = planJournalReplay({
    records,
    notesById,
    isDeleted,
    now,
    // The note's committed text, from the same read: the replay has to be able
    // to tell a record that holds something the note lacks from one a save has
    // already overtaken, and the timestamp on the list row cannot tell them
    // apart.
    storedContentFor: (noteId) => {
      const key = noteKeyFor?.(noteId);
      return key ? storedEntries.get(key) ?? null : null;
    },
  });
  const writes = plan.restore
    .map((row) => [noteKeyFor?.(row.id) || `${userId}:${row.id}`, row.content])
    .filter(([key]) => Boolean(key));

  try {
    await writeThrough(store, writes, plan.clear);
  } catch (error) {
    // A journal that cannot be replayed stays where it is: the text is still in
    // the record, and the next open tries again.
    console.warn('Failed to replay the note journal:', error);
    return { restored: [], cleared: 0, discarded };
  }

  return { restored: plan.restore, cleared: plan.clear.length, discarded };
};
