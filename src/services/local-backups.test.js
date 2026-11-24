import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  BACKUP_INDEX_KEY,
  BACKUP_MAX_AGE_MS,
  MAX_LOCAL_BACKUPS,
  backupStorageKey,
  pruneBackupIndex,
  readBackup,
  readBackupIndex,
  restoreLocalBackup,
  shouldWriteBackup,
  writeLocalBackup,
} from './local-backups';

// A Web Storage stand-in: the backup layer only ever uses the four primitives a
// browser store exposes, so the unit suite can own a real rotation test without
// a browser.
const createStore = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key: (index) => Array.from(map.keys())[index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    has: (key) => map.has(key),
  };
};

const notes = [
  { id: 'note-1', title: 'Alpha', updated: 1000 },
  { id: 'note-2', title: 'Beta', updated: 2000, isPinned: true },
];
const readContent = async (note) => `# ${note.title}\n\nbody`;

describe('readBackupIndex', () => {
  it('reads an empty store as no backups', () => {
    expect(readBackupIndex(createStore())).toEqual([]);
    expect(readBackupIndex(null)).toEqual([]);
  });

  it('reads a corrupt index as no backups instead of throwing', () => {
    expect(readBackupIndex(createStore({ [BACKUP_INDEX_KEY]: '{not json' }))).toEqual([]);
    expect(readBackupIndex(createStore({ [BACKUP_INDEX_KEY]: '"a string"' }))).toEqual([]);
  });

  it('drops entries without an id or a timestamp and sorts newest first', () => {
    const store = createStore({
      [BACKUP_INDEX_KEY]: JSON.stringify([
        { id: 'old', createdAt: 10 },
        { createdAt: 20 },
        { id: 'new', createdAt: 30, noteCount: 2, bytes: 42 },
        null,
      ]),
    });
    expect(readBackupIndex(store).map((entry) => entry.id)).toEqual(['new', 'old']);
    expect(readBackupIndex(store)[0]).toMatchObject({ noteCount: 2, bytes: 42 });
  });
});

describe('writeLocalBackup', () => {
  it('writes a snapshot of every note and records it in the index', async () => {
    const store = createStore();
    const result = await writeLocalBackup({ notes, readContent, store, now: 5000 });

    expect(result.ok).toBe(true);
    expect(result.entry).toMatchObject({ id: '5000', createdAt: 5000, noteCount: 2 });
    expect(result.index.map((entry) => entry.id)).toEqual(['5000']);

    const snapshot = readBackup('5000', store);
    expect(snapshot.notes).toHaveLength(2);
    expect(snapshot.notes[0]).toMatchObject({ id: 'note-1', title: 'Alpha', content: '# Alpha\n\nbody' });
  });

  it('survives a note whose content cannot be read', async () => {
    const store = createStore();
    const result = await writeLocalBackup({
      notes,
      readContent: async (note) => {
        if (note.id === 'note-2') throw new Error('gone');
        return '# Alpha';
      },
      store,
      now: 5000,
    });

    expect(result.ok).toBe(true);
    expect(readBackup('5000', store).notes[1].content).toBe('');
  });

  it('rotates: the fourth snapshot drops the oldest and deletes its key', async () => {
    const store = createStore();
    for (const now of [1000, 2000, 3000, 4000]) {
      await writeLocalBackup({ notes, readContent, store, now });
    }

    const index = readBackupIndex(store);
    expect(index).toHaveLength(MAX_LOCAL_BACKUPS);
    expect(index.map((entry) => entry.id)).toEqual(['4000', '3000', '2000']);
    expect(store.has(backupStorageKey('1000'))).toBe(false);
    expect(store.has(backupStorageKey('4000'))).toBe(true);
  });

  it('refuses an empty notebook and a store that is not there', async () => {
    expect(await writeLocalBackup({ notes: [], readContent, store: createStore() })).toMatchObject({
      ok: false,
    });
    expect(await writeLocalBackup({ notes, readContent, store: null })).toMatchObject({
      ok: false,
    });
  });

  it('turns a full store into the sentence with the step that helps', async () => {
    const store = createStore();
    store.setItem = () => {
      const error = new Error('quota');
      error.name = 'QuotaExceededError';
      throw error;
    };

    const result = await writeLocalBackup({ notes, readContent, store, now: 5000 });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Storage is full/);
  });
});

describe('shouldWriteBackup', () => {
  it('backs up when there is no backup yet', () => {
    expect(shouldWriteBackup([], 5000)).toBe(true);
  });

  it('backs up once a day, not on every open', () => {
    const index = [{ id: '1000', createdAt: 1000 }];
    expect(shouldWriteBackup(index, 1000 + BACKUP_MAX_AGE_MS - 1)).toBe(false);
    expect(shouldWriteBackup(index, 1000 + BACKUP_MAX_AGE_MS)).toBe(true);
  });
});

describe('pruneBackupIndex', () => {
  it('keeps three entries without a store to delete from', () => {
    const kept = pruneBackupIndex(
      [1, 2, 3, 4].map((n) => ({ id: String(n), createdAt: n })),
      null
    );
    expect(kept.map((entry) => entry.id)).toEqual(['4', '3', '2']);
  });
});

describe('restoreLocalBackup', () => {
  const storage = {
    noteStorageKey: (id) => `local:${id}`,
    scopedKey: (key) => `local:${key}`,
  };
  let set;

  beforeEach(() => {
    set = vi.fn(() => Promise.resolve());
    window.storage = { set, get: vi.fn(), delete: vi.fn() };
  });

  afterEach(() => {
    delete window.storage;
  });

  it('writes back the notes the notebook no longer has', async () => {
    const snapshot = {
      createdAt: 1000,
      notes: [
        { id: 'note-1', title: 'Alpha', content: '# Alpha' },
        { id: 'note-2', title: 'Beta', content: '# Beta', isPinned: true },
      ],
    };

    const result = await restoreLocalBackup({
      snapshot,
      currentNotes: [{ id: 'note-2', title: 'Beta' }],
      storage,
      now: 7000,
    });

    expect(result.restored.map((note) => note.id)).toEqual(['note-1']);
    expect(result.skipped).toBe(1);
    expect(set).toHaveBeenCalledWith('local:note-1', '# Alpha');
    // The recovered note is listed: its row joins the cache the list reads.
    const cacheCall = set.mock.calls.find(([key]) => key === 'local:notes-cache');
    expect(JSON.parse(cacheCall[1]).map((note) => note.id)).toEqual(['note-1', 'note-2']);
  });

  it('writes nothing when every note in the backup is already here', async () => {
    const result = await restoreLocalBackup({
      snapshot: { notes: [{ id: 'note-1', title: 'Alpha', content: '# Alpha' }] },
      currentNotes: [{ id: 'note-1' }],
      storage,
    });

    expect(result).toEqual({ restored: [], skipped: 1 });
    expect(set).not.toHaveBeenCalled();
  });

  it('ignores a snapshot it cannot use', async () => {
    expect(await restoreLocalBackup({ snapshot: null, storage })).toEqual({
      restored: [],
      skipped: 0,
    });
    expect(await restoreLocalBackup({ snapshot: { notes: [] }, storage: null })).toEqual({
      restored: [],
      skipped: 0,
    });
  });
});
