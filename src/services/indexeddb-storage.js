/**
 * IndexedDB — the notebook's own store.
 *
 * Slice 2's last piece: the notes stop living in `localStorage`. Web Storage
 * caps an origin at a few megabytes and holds every note as one string in the
 * same bucket as preferences; IndexedDB is the store a notebook is supposed to
 * be on — hundreds of megabytes, real transactions, and a seam that is already
 * async everywhere it matters.
 *
 * The seam is the point. `createIndexedDbAdapter` implements the surface
 * `createLocalStorageAdapter` implements — `get`, `set`, `setMany`, `delete`,
 * `entries`, `keys`, `measure` — so the app never learns which store it is on:
 * `src/services/storage-adapter.js` picks one at boot and `main.jsx` puts it
 * behind `window.storage`. That is why the store swap is one new file plus a
 * boot decision and not a rebuild; the journal session grew the seam for
 * exactly this.
 *
 * The driver is separated from the adapter on purpose: `createIndexedDbDriver`
 * owns the IndexedDB API and the adapter owns the seam's semantics, so the
 * semantics are unit-testable with an in-memory driver and no new dependency,
 * while the real IndexedDB path is proven end to end in a real browser
 * (`tests/indexeddb-store.spec.js`).
 */
import {
  getBrowserStorage,
  measureStorageEntries,
  readBrowserStorageEntries,
} from './browser-storage';
import { BACKUP_INDEX_KEY, BACKUP_KEY_PREFIX } from './local-backups';
import { storageUnavailableError } from './storage-failure';

export const INDEXED_DB_NAME = 'canonote';
export const INDEXED_DB_VERSION = 1;
export const INDEXED_DB_STORE = 'kv';

/**
 * The keys the notebook itself owns. Every note, the list cache, the current
 * id, the journal records and the version history are written through the seam
 * under the local user's prefix, so `<user>:` is the whole store — with two
 * deliberate exceptions that stay in Web Storage:
 *
 * - the backup snapshots and their index, because a backup kept in the store
 *   it exists to survive is not a backup;
 * - everything with no prefix (`agent-name`, `helper-open`, `theme`, the AI
 *   key), which is preferences and diagnostics, not notes.
 */
export const NOTEBOOK_KEY_PREFIX = 'local:';

export const isNotebookStoreKey = (key) =>
  typeof key === 'string' &&
  key.startsWith(NOTEBOOK_KEY_PREFIX) &&
  !key.startsWith(BACKUP_KEY_PREFIX) &&
  key !== BACKUP_INDEX_KEY;

export const indexedDbAvailable = () => {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
};

/**
 * The IndexedDB API, behind four calls the adapter needs. A driver that cannot
 * open rejects with `storageUnavailableError` when there is no IndexedDB at
 * all, and with the browser's own error when there is one but it refuses
 * (a SecurityError from blocked site data reaches `describeStorageFailure`
 * unchanged).
 */
export const createIndexedDbDriver = () => {
  let opening = null;

  const open = () => {
    if (opening) return opening;

    opening = new Promise((resolve, reject) => {
      if (!indexedDbAvailable()) {
        reject(storageUnavailableError(INDEXED_DB_NAME));
        return;
      }

      let request;
      try {
        request = indexedDB.open(INDEXED_DB_NAME, INDEXED_DB_VERSION);
      } catch (error) {
        reject(error);
        return;
      }

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(INDEXED_DB_STORE)) {
          database.createObjectStore(INDEXED_DB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || storageUnavailableError(INDEXED_DB_NAME));
      request.onblocked = () => reject(storageUnavailableError(INDEXED_DB_NAME));
    }).catch((error) => {
      // A store that would not open must not be remembered as open: the next
      // call asks the browser again (it may have been a transient block).
      opening = null;
      throw error;
    });

    return opening;
  };

  const transaction = async (mode, work) => {
    const database = await open();
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = database.transaction(INDEXED_DB_STORE, mode);
      } catch (error) {
        reject(error);
        return;
      }

      const store = tx.objectStore(INDEXED_DB_STORE);
      let result;
      try {
        result = work(store);
      } catch (error) {
        try {
          tx.abort();
        } catch {
          // The transaction is already gone; the error below is the real one.
        }
        reject(error);
        return;
      }

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || storageUnavailableError(INDEXED_DB_STORE));
      tx.onabort = () => reject(tx.error || storageUnavailableError(INDEXED_DB_STORE));
    });
  };

  return {
    open,

    async get(key) {
      const database = await open();
      return new Promise((resolve, reject) => {
        let tx;
        try {
          tx = database.transaction(INDEXED_DB_STORE, 'readonly');
        } catch (error) {
          reject(error);
          return;
        }
        const request = tx.objectStore(INDEXED_DB_STORE).get(key);
        request.onsuccess = () => resolve(request.result === undefined ? null : request.result);
        request.onerror = () => reject(request.error || storageUnavailableError(key));
        tx.onabort = () => reject(tx.error || storageUnavailableError(key));
      });
    },

    /**
     * Several pairs and the keys that are done with, as one transaction: the
     * writes and the removals either all land or none do. That is the ordering
     * the journal depends on — a record is only cleared once the content it
     * holds has been committed — and IndexedDB can promise it outright where
     * Web Storage had to be ordered by hand.
     */
    async setMany(entries = [], { remove = [] } = {}) {
      return transaction('readwrite', (store) => {
        for (const [key, value] of entries) store.put(value, key);
        for (const key of remove) store.delete(key);
        return true;
      });
    },

    async keys() {
      const database = await open();
      return new Promise((resolve, reject) => {
        let tx;
        try {
          tx = database.transaction(INDEXED_DB_STORE, 'readonly');
        } catch (error) {
          reject(error);
          return;
        }
        const request = tx.objectStore(INDEXED_DB_STORE).getAllKeys();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error || storageUnavailableError(INDEXED_DB_STORE));
        tx.onabort = () => reject(tx.error || storageUnavailableError(INDEXED_DB_STORE));
      });
    },
  };
};

const readEntries = async (driver) => {
  const keys = await driver.keys();
  const entries = [];
  for (const key of keys) {
    const value = await driver.get(key);
    if (typeof value === 'string') entries.push([key, value]);
  }
  return entries;
};

export const createIndexedDbAdapter = ({ driver = createIndexedDbDriver() } = {}) => {
  const readAll = async () => {
    try {
      return await readEntries(driver);
    } catch (error) {
      // A store that cannot be read answers nothing rather than throwing: a
      // notebook whose store is unreadable should still open.
      console.error('Storage entries error:', error);
      return [];
    }
  };

  return {
    async get(key) {
      try {
        const value = await driver.get(key);
        return value === undefined || value === null ? null : { value: String(value) };
      } catch (error) {
        console.error('Storage get error:', error);
        return null;
      }
    },

    async set(key, value) {
      await driver.setMany([[key, value]]);
    },

    async setMany(entries = [], { remove = [] } = {}) {
      await driver.setMany(entries, { remove });
    },

    async delete(key) {
      try {
        await driver.setMany([], { remove: [key] });
      } catch (error) {
        console.error('Storage delete error:', error);
      }
    },

    entries: readAll,

    async keys() {
      try {
        return await driver.keys();
      } catch (error) {
        console.error('Storage keys error:', error);
        return [];
      }
    },

    async measure() {
      const entries = await readAll();
      return entries.length === 0 ? 0 : measureStorageEntries(entries);
    },

    async initialize() {
      await driver.open();
      return { mode: 'indexeddb', message: 'Using IndexedDB for the notebook' };
    },
  };
};

/**
 * Move the notebook out of Web Storage, once, on boot.
 *
 * There is no "already migrated" flag on purpose. A notebook key can only be
 * sitting in `localStorage` because the app wrote it there, and the app only
 * writes there when IndexedDB is unavailable — so whatever is found is the
 * newest state the app could produce, and copying it up (and then clearing it)
 * makes the fallback round trip lossless: a session on a browser that blocked
 * IndexedDB is picked up by the next session on one that allows it.
 *
 * The copy is one transaction and the Web Storage keys are removed only after
 * it commits, so a failed write leaves the notes where they were. The backup
 * snapshots and the preferences are not touched: they are not notebook keys.
 */
export const migrateNotebookToIndexedDb = async (adapter, { storage = getBrowserStorage() } = {}) => {
  if (!storage) return { migrated: false, keys: 0, reason: 'no-web-storage' };

  const entries = readBrowserStorageEntries(storage).filter(([key]) => isNotebookStoreKey(key));
  if (entries.length === 0) return { migrated: false, keys: 0, reason: 'nothing-to-move' };

  try {
    await adapter.setMany(entries);
  } catch (error) {
    console.error('Storage migration error:', error);
    return { migrated: false, keys: 0, reason: 'write-failed' };
  }

  for (const [key] of entries) {
    try {
      storage.removeItem(key);
    } catch {
      // A key that will not delete is copied again on the next boot, with the
      // same value: harmless, and better than failing the migration.
    }
  }
  return { migrated: true, keys: entries.length, reason: null };
};
