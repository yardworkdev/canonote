import { describe, expect, it, vi } from 'vitest';
import {
  createIndexedDbAdapter,
  isNotebookStoreKey,
  migrateNotebookToIndexedDb,
} from './indexeddb-storage';
import { BACKUP_INDEX_KEY, backupStorageKey } from './local-backups';

// An in-memory driver with the four calls the adapter makes. The real IndexedDB
// path is proven in a browser (`tests/indexeddb-store.spec.js`); what is pinned
// here is the seam's semantics — what `get` answers, that a refused write
// reaches the caller, that several pairs and the removals are one call, and
// that the migration moves the notebook without touching anything else.
const createDriver = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    map,
    open: vi.fn(async () => {}),
    get: vi.fn(async (key) => (map.has(key) ? map.get(key) : null)),
    setMany: vi.fn(async (entries = [], { remove = [] } = {}) => {
      for (const [key, value] of entries) map.set(key, value);
      for (const key of remove) map.delete(key);
      return true;
    }),
    keys: vi.fn(async () => Array.from(map.keys())),
  };
};

// The four primitives a browser store exposes, in memory.
const createWebStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    map,
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
  };
};

describe('createIndexedDbAdapter', () => {
  it('answers a value as { value } and a missing key as null', async () => {
    const adapter = createIndexedDbAdapter({ driver: createDriver({ 'local:note-1': '# One' }) });

    expect(await adapter.get('local:note-1')).toEqual({ value: '# One' });
    expect(await adapter.get('local:note-2')).toBeNull();
  });

  it('answers null rather than throwing when the store cannot be read', async () => {
    const driver = createDriver();
    driver.get = vi.fn(async () => {
      throw new Error('store gone');
    });
    const adapter = createIndexedDbAdapter({ driver });

    expect(await adapter.get('local:note-1')).toBeNull();
  });

  it('writes one pair, several pairs, and the removals that finish them', async () => {
    const driver = createDriver({ 'local:old': 'x' });
    const adapter = createIndexedDbAdapter({ driver });

    await adapter.set('local:note-1', '# One');
    await adapter.setMany(
      [
        ['local:note-1', '# One, revised'],
        ['local:note-2', '# Two'],
      ],
      { remove: ['local:old'] }
    );

    expect(driver.map.get('local:note-1')).toBe('# One, revised');
    expect(driver.map.get('local:note-2')).toBe('# Two');
    expect(driver.map.has('local:old')).toBe(false);
    // One call: the writes and the removals are one transaction, which is the
    // ordering the journal depends on.
    expect(driver.setMany).toHaveBeenCalledTimes(2);
  });

  it('lets a refused write reach the caller, and swallows a refused delete', async () => {
    const driver = createDriver();
    driver.setMany = vi.fn(async () => {
      const error = Object.assign(new Error('nope'), { name: 'QuotaExceededError' });
      throw error;
    });
    const adapter = createIndexedDbAdapter({ driver });

    await expect(adapter.set('local:note-1', '# One')).rejects.toThrow('nope');
    // A delete that fails must not take the caller down with it.
    await expect(adapter.delete('local:note-1')).resolves.toBeUndefined();
  });

  it('enumerates its own keys and entries, and measures them in code units', async () => {
    const adapter = createIndexedDbAdapter({
      driver: createDriver({ 'local:note-1': '# One', 'local:notes-cache': '[]' }),
    });

    expect((await adapter.keys()).sort()).toEqual(['local:note-1', 'local:notes-cache']);
    expect(await adapter.entries()).toEqual([
      ['local:note-1', '# One'],
      ['local:notes-cache', '[]'],
    ]);
    // ('local:note-1' + '# One') = 12 + 5 = 17 code units, doubled = 34 bytes;
    // ('local:notes-cache' + '[]') = 17 + 2 = 19, doubled = 38. Total 72.
    expect(await adapter.measure()).toBe(72);
  });

  it('measures an empty store as zero and opens the store on initialize', async () => {
    const driver = createDriver();
    const adapter = createIndexedDbAdapter({ driver });

    expect(await adapter.measure()).toBe(0);
    expect(await adapter.initialize()).toMatchObject({ mode: 'indexeddb' });
    expect(driver.open).toHaveBeenCalledTimes(1);
  });
});

describe('the notebook key space', () => {
  it('is every local-user key except the backups', () => {
    expect(isNotebookStoreKey('local:note-1')).toBe(true);
    expect(isNotebookStoreKey('local:notes-cache')).toBe(true);
    expect(isNotebookStoreKey('local:notes-current-id')).toBe(true);
    expect(isNotebookStoreKey('local:note-draft:note-1')).toBe(true);

    // The backups live in Web Storage on purpose: a backup kept in the store it
    // exists to survive is not a backup.
    expect(isNotebookStoreKey(BACKUP_INDEX_KEY)).toBe(false);
    expect(isNotebookStoreKey(backupStorageKey('1000'))).toBe(false);

    // Preferences and diagnostics are not notes.
    expect(isNotebookStoreKey('agent-name')).toBe(false);
    expect(isNotebookStoreKey('helper-open')).toBe(false);
    expect(isNotebookStoreKey(null)).toBe(false);
  });
});

describe('migrateNotebookToIndexedDb', () => {
  it('moves every notebook key into the store and clears it from Web Storage', async () => {
    const driver = createDriver();
    const adapter = createIndexedDbAdapter({ driver });
    const storage = createWebStorage({
      'local:notes-cache': '[]',
      'local:note-1': '# One',
      'agent-name': 'Notetaker',
      [BACKUP_INDEX_KEY]: '[]',
      [backupStorageKey('1000')]: '{"notes":[]}',
    });

    const result = await migrateNotebookToIndexedDb(adapter, { storage });

    expect(result).toMatchObject({ migrated: true, keys: 2 });
    expect(driver.map.get('local:note-1')).toBe('# One');
    expect(storage.map.has('local:note-1')).toBe(false);
    expect(storage.map.has('local:notes-cache')).toBe(false);
    // The preference and the backup snapshots stay where they are.
    expect(storage.map.get('agent-name')).toBe('Notetaker');
    expect(storage.map.has(BACKUP_INDEX_KEY)).toBe(true);
    expect(storage.map.has(backupStorageKey('1000'))).toBe(true);
  });

  it('leaves Web Storage alone when the write is refused', async () => {
    const driver = createDriver();
    driver.setMany = vi.fn(async () => {
      throw new Error('no room');
    });
    const adapter = createIndexedDbAdapter({ driver });
    const storage = createWebStorage({ 'local:note-1': '# One' });

    const result = await migrateNotebookToIndexedDb(adapter, { storage });

    expect(result).toMatchObject({ migrated: false, reason: 'write-failed' });
    expect(storage.map.get('local:note-1')).toBe('# One');
  });

  it('is a no-op when there is nothing to move, or no Web Storage at all', async () => {
    const adapter = createIndexedDbAdapter({ driver: createDriver() });

    expect(await migrateNotebookToIndexedDb(adapter, { storage: createWebStorage() })).toMatchObject(
      { migrated: false, reason: 'nothing-to-move' }
    );
    expect(await migrateNotebookToIndexedDb(adapter, { storage: null })).toMatchObject({
      migrated: false,
      reason: 'no-web-storage',
    });
  });
});
