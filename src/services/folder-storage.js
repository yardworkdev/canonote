/**
 * A folder the user picks — the notebook's second store.
 *
 * The storage model is Ves's open decision (a folder the user picks, a small
 * backend with a managed Postgres, or a repo per user), and the seam is what
 * makes that decision an adapter swap instead of a rebuild. This is adapter
 * two: the notebook opens a folder the user owns — `~/Dropbox/notes`,
 * `~/iCloud/Notes`, any directory — and edits **real `.md` files** there, so
 * cross-device sync comes free from the drive they already pay for and the
 * notes are readable by every other tool they own. No accounts, no server.
 *
 * What the seam sees is still key/value pairs; what the folder holds is
 * markdown. The mapping is the whole design:
 *
 * - a note (`<user>:note-<id>`) is one file, `<title>.md`, holding exactly the
 *   note's markdown — the same text the editor shows, nothing added;
 * - everything else the notebook keeps (`notes-cache`, `notes-current-id`, the
 *   journal records, the version history) is bookkeeping derived from those
 *   files, so it lives in one sidecar, `.canonote.json`, rather than as a
 *   hundred tiny files next to the user's notes.
 *
 * The sidecar is a convenience, never the truth. A `.md` file in the folder
 * that the sidecar has never heard of is adopted on open as a note (that is how
 * notes written elsewhere, or files copied in by hand, arrive), and a file the
 * user deleted is a note the user deleted. Losing `.canonote.json` therefore
 * costs the list metadata, not a single word.
 *
 * Honest limits, stated because they are real: File System Access is
 * Chrome/Edge only (a browser without it keeps the browser store, no prompt
 * shown), there is no phone, and two people cannot share a folder. Permission
 * is per-session in the browser's own terms, so a notebook whose folder has
 * gone back to `prompt` falls back to the browser store and offers to
 * reconnect rather than blocking the open.
 *
 * The driver is separated from the adapter exactly as in
 * `indexeddb-storage.js`: the driver owns the File System Access API, the
 * adapter owns the seam's semantics, and the semantics are unit-tested against
 * an in-memory driver (`folder-storage.test.js`) while the real API path is
 * proven in a real browser against a real directory (`tests/folder-store.spec.js`).
 */
import { measureStorageEntries } from './browser-storage';
import { NOTEBOOK_KEY_PREFIX, createIndexedDbDriver } from './indexeddb-storage';
import { storageUnavailableError } from './storage-failure';
import { titleFromMarkdown } from '../utils/markdown';

export const FOLDER_STATE_FILE = '.canonote.json';
export const FOLDER_HANDLE_KEY = 'folder-handle';
export const NOTE_STORE_KEY_PREFIX = `${NOTEBOOK_KEY_PREFIX}note-`;

/** Is this browser one that can hand the notebook a folder at all? */
export const folderStorageAvailable = () => {
  try {
    return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  } catch {
    return false;
  }
};

/**
 * Ask the user for a folder. Must be called from a user gesture — the browser
 * requires one, which is why the picker lives on a button in the Storage panel.
 */
export const requestFolderHandle = async () => {
  if (!folderStorageAvailable()) throw storageUnavailableError('folder');
  return window.showDirectoryPicker({ id: 'canonote-notebook', mode: 'readwrite' });
};

/**
 * The boundary between a note and the notebook's bookkeeping, in one place: a
 * note key is `<user>:note-<id>` with no `:` after the id, so
 * `notes-cache`, `note-draft:<id>`, `note-versions:<id>` and
 * `conflict-draft:<id>` are not notes. Widening this reads the list cache as a
 * note — the trap the orphan scan already paid for once.
 */
export const isNoteStoreKey = (key) =>
  typeof key === 'string' &&
  key.startsWith(NOTE_STORE_KEY_PREFIX) &&
  !key.slice(NOTE_STORE_KEY_PREFIX.length).includes(':');

export const noteIdFromStoreKey = (key) =>
  isNoteStoreKey(key) ? key.slice(NOTEBOOK_KEY_PREFIX.length) : null;

/** A note's title, as a file name a person would write: `release-checklist`. */
export const slugFromMarkdown = (value, fallback = 'untitled') => {
  const title = titleFromMarkdown(typeof value === 'string' ? value : '');
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || fallback;
};

const emptyState = () => ({ values: {}, files: {} });

/**
 * The File System Access API, behind six calls the adapter needs. Every read
 * of a missing file answers `null` (a file that is not there is not an error),
 * and every other failure is thrown so the boot path can fall back.
 */
export const createFolderDriver = (directoryHandle) => {
  if (!directoryHandle) throw storageUnavailableError('folder');

  const readFile = async (name) => {
    try {
      const handle = await directoryHandle.getFileHandle(name);
      const file = await handle.getFile();
      return await file.text();
    } catch (error) {
      if (error?.name === 'NotFoundError') return null;
      throw error;
    }
  };

  const writeFile = async (name, text) => {
    const handle = await directoryHandle.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(text);
    } finally {
      await writable.close();
    }
  };

  const removeFile = async (name) => {
    try {
      await directoryHandle.removeEntry(name);
    } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
    }
  };

  return {
    name: directoryHandle.name || 'folder',
    readFile,
    writeFile,
    removeFile,

    async readState() {
      const raw = await readFile(FOLDER_STATE_FILE);
      if (!raw) return emptyState();
      try {
        const parsed = JSON.parse(raw);
        return {
          values:
            parsed?.values && typeof parsed.values === 'object' && !Array.isArray(parsed.values)
              ? parsed.values
              : {},
          files:
            parsed?.files && typeof parsed.files === 'object' && !Array.isArray(parsed.files)
              ? parsed.files
              : {},
        };
      } catch {
        // A sidecar nobody can parse is a sidecar that can be rebuilt from the
        // markdown beside it; it must never stop the notebook from opening.
        return emptyState();
      }
    },

    writeState: (state) => writeFile(FOLDER_STATE_FILE, JSON.stringify(state, null, 2)),

    async listMarkdownFiles() {
      const names = [];
      try {
        for await (const [name, handle] of directoryHandle.entries()) {
          if (handle?.kind === 'file' && /\.md$/i.test(name)) names.push(name);
        }
      } catch {
        // A folder that will not enumerate reads as an empty one; the notes it
        // holds are still opened by name when their key is asked for.
        return [];
      }
      return names.sort();
    },
  };
};

/**
 * The seam, over a folder. Same surface as the other two adapters: `get`,
 * `set`, `setMany`, `delete`, `entries`, `keys`, `measure`, `initialize`.
 */
export const createFolderAdapter = ({ driver, prefix = NOTEBOOK_KEY_PREFIX } = {}) => {
  if (!driver) throw storageUnavailableError('folder');

  let state = emptyState();

  /**
   * One operation at a time. Every operation here mutates or reads the shared
   * `state` across `await`s, and the app really does overlap them — the orphan
   * scan reads `keys()` while the debounced save is writing. Two things went
   * wrong without this queue, both of them note loss: the scan adopted a file
   * the save had just written but not yet recorded as a *second* note (two rows
   * with one title), and the next save then saw its own name as taken and moved
   * the note to `alpha-2.md`.
   */
  let queue = Promise.resolve();
  const serialize = (operation) => {
    const result = queue.then(operation);
    queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  const noteKeyFor = (noteId) => `${prefix}${noteId}`;
  const fileNameFor = (noteId) => state.files[noteId]?.name || null;

  /**
   * The names that are taken, asked of the folder itself and not only of the
   * sidecar: a file the user dropped in while the notebook was open is in the
   * folder and not yet in `state.files`, and writing over it would destroy a
   * note. `exclude` holds the names this write is allowed to reuse — the file
   * the note is already on, so a title change can keep its own name.
   */
  const uniqueFileName = async (base, exclude = []) => {
    const excluded = new Set(exclude.filter(Boolean));
    let names = [];
    try {
      names = await driver.listMarkdownFiles();
    } catch {
      names = [];
    }
    const taken = new Set(names.filter((name) => !excluded.has(name)));
    Object.values(state.files).forEach((entry) => {
      if (entry?.name && !excluded.has(entry.name)) taken.add(entry.name);
    });
    let candidate = `${base}.md`;
    let suffix = 2;
    while (taken.has(candidate)) {
      candidate = `${base}-${suffix}.md`;
      suffix += 1;
    }
    return candidate;
  };

  /**
   * Write a note's text to its file. A file the notebook named is renamed when
   * the note's title changes, because the name is the title; a file the user
   * brought in keeps the name they gave it. The name is recorded *before* the
   * file lands, so nothing can read the file in between and call it a second
   * note.
   */
  const writeNote = async (noteId, value) => {
    const text = String(value ?? '');
    const entry = state.files[noteId];
    const previous = entry?.name || null;
    let name = previous;

    if (!name) {
      name = await uniqueFileName(slugFromMarkdown(text));
    } else if (entry.managed !== false) {
      // The name is the title: a note the notebook named follows its title, and
      // the old file goes when the new one is written.
      const desired = await uniqueFileName(slugFromMarkdown(text), [previous]);
      if (desired !== name) name = desired;
    }

    state.files[noteId] = { name, managed: entry?.managed !== false };
    try {
      await driver.writeFile(name, text);
    } catch (error) {
      if (entry) state.files[noteId] = entry;
      else delete state.files[noteId];
      throw error;
    }
    if (previous && previous !== name) await driver.removeFile(previous);
  };

  const removeNote = async (noteId) => {
    const name = fileNameFor(noteId);
    if (name) await driver.removeFile(name);
    delete state.files[noteId];
  };

  /**
   * Reconcile the sidecar with the folder: adopt every `.md` file it has not
   * seen (deterministically, so the id a file gets is the same on every boot),
   * and forget the notes whose file the user removed. The folder is the truth.
   */
  const adoptFiles = async () => {
    const names = await driver.listMarkdownFiles();
    const present = new Set(names);
    Object.entries(state.files).forEach(([noteId, entry]) => {
      if (!present.has(entry.name)) delete state.files[noteId];
    });

    const known = new Set(Object.values(state.files).map((entry) => entry.name));
    const adopted = [];
    for (const name of names) {
      if (known.has(name)) continue;
      const base = slugFromMarkdown(name.replace(/\.md$/i, ''), 'note');
      let noteId = `note-${base}`;
      let suffix = 2;
      while (state.files[noteId]) {
        noteId = `note-${base}-${suffix}`;
        suffix += 1;
      }
      state.files[noteId] = { name, managed: false };
      adopted.push(noteId);
    }
    return adopted;
  };

  const readAll = async () => {
    const pairs = [];
    for (const key of await keys()) {
      const row = await get(key);
      if (row) pairs.push([key, row.value]);
    }
    return pairs;
  };

  async function get(key) {
    if (isNoteStoreKey(key)) {
      const name = fileNameFor(noteIdFromStoreKey(key));
      if (!name) return null;
      try {
        const text = await driver.readFile(name);
        return text === null ? null : { value: text };
      } catch (error) {
        console.error('Storage get error:', error);
        return null;
      }
    }
    const value = state.values[key];
    return typeof value === 'string' ? { value } : null;
  }

  async function keys() {
    await adoptFiles();
    return [...Object.keys(state.values), ...Object.keys(state.files).map(noteKeyFor)];
  }

  return {
    get,
    keys: () => serialize(keys),
    entries: () => serialize(readAll),

    set: (key, value) =>
      serialize(async () => {
        if (isNoteStoreKey(key)) await writeNote(noteIdFromStoreKey(key), value);
        else state.values[key] = String(value ?? '');
        await driver.writeState(state);
      }),

    /**
     * Several pairs as one seam call, then the pairs that are done with
     * removed — writes first, so a save that fails leaves the journal record
     * and the text where they were, and the sidecar is written once.
     */
    setMany: (entries = [], { remove = [] } = {}) =>
      serialize(async () => {
        for (const [key, value] of entries) {
          if (isNoteStoreKey(key)) await writeNote(noteIdFromStoreKey(key), value);
          else state.values[key] = String(value ?? '');
        }
        for (const key of remove) {
          if (isNoteStoreKey(key)) await removeNote(noteIdFromStoreKey(key));
          else delete state.values[key];
        }
        await driver.writeState(state);
      }),

    delete: (key) =>
      serialize(async () => {
        try {
          if (isNoteStoreKey(key)) await removeNote(noteIdFromStoreKey(key));
          else delete state.values[key];
          await driver.writeState(state);
        } catch (error) {
          console.error('Storage delete error:', error);
        }
      }),

    measure: () =>
      serialize(async () => {
        try {
          const entries = await readAll();
          return entries.length === 0 ? 0 : measureStorageEntries(entries);
        } catch (error) {
          console.error('Storage measure error:', error);
          return null;
        }
      }),

    initialize: () =>
      serialize(async () => {
        state = await driver.readState();
        const adopted = await adoptFiles();
        if (adopted.length > 0) {
          try {
            await driver.writeState(state);
          } catch (error) {
            // The adopted notes are already readable by name; only the sidecar
            // did not get the entry, and the next write will carry it.
            console.warn('Notes folder state not written:', error);
          }
        }
        return { mode: 'folder', message: `Notes are .md files in “${driver.name}”` };
      }),
  };
};

/**
 * The browser's own answer about the folder: `granted`, `prompt` or `denied`.
 * `request` is only allowed from a user gesture, so boot asks and the panel
 * asks — the same question, one of them allowed to show the browser prompt.
 */
export const folderPermission = async (handle, { request = false } = {}) => {
  if (!handle || typeof handle.queryPermission !== 'function') return 'granted';
  try {
    const current = await handle.queryPermission({ mode: 'readwrite' });
    if (current === 'granted' || !request) return current;
    if (typeof handle.requestPermission !== 'function') return current;
    return await handle.requestPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
};

/**
 * The chosen folder is remembered as the handle itself, in IndexedDB — a
 * handle is not a path and is not a string, so it cannot live in the notebook's
 * key space and must not be written to Web Storage. It is bookkeeping, not a
 * note: the key carries no `<user>:` prefix, so the notebook never reads it.
 */
export const readSavedFolderHandle = async (driver = createIndexedDbDriver()) => {
  try {
    const handle = await driver.get(FOLDER_HANDLE_KEY);
    return handle || null;
  } catch {
    return null;
  }
};

export const saveFolderHandle = async (handle, driver = createIndexedDbDriver()) => {
  try {
    await driver.setMany([[FOLDER_HANDLE_KEY, handle]]);
    return true;
  } catch {
    return false;
  }
};

export const forgetFolderHandle = async (driver = createIndexedDbDriver()) => {
  try {
    await driver.setMany([], { remove: [FOLDER_HANDLE_KEY] });
    return true;
  } catch {
    return false;
  }
};

/**
 * The folder the notebook was last on, if it can still be opened: a handle that
 * was saved, whose permission is still granted, whose directory still opens.
 * Anything less answers `null` and the boot path uses the browser store — a
 * notebook must open even when the drive is unplugged.
 */
export const connectSavedFolder = async () => {
  if (!folderStorageAvailable()) return null;
  const handle = await readSavedFolderHandle();
  if (!handle) return null;
  if ((await folderPermission(handle)) !== 'granted') return null;

  const adapter = createFolderAdapter({ driver: createFolderDriver(handle) });
  await adapter.initialize();
  return { adapter, handle, name: handle.name || 'folder' };
};
