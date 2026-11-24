import { createLocalStorageAdapter } from './browser-storage';
import { createIndexedDbAdapter, migrateNotebookToIndexedDb } from './indexeddb-storage';
import { connectSavedFolder, folderStorageAvailable } from './folder-storage';

let defaultAdapter = null;
let storageMode = { mode: 'local', folderName: null };

export const getStorageAdapter = () => {
  if (!defaultAdapter) {
    defaultAdapter = createLocalStorageAdapter();
  }
  return defaultAdapter;
};

/**
 * Where the notebook ended up, for the surfaces that have to state it: the
 * status row under the editor and the Storage panel. The seam cannot carry it —
 * `window.storage` is normalized down to the seam's methods — so the boot
 * decision records it here.
 */
export const getStorageMode = () => storageMode;

export const setStorageMode = (mode) => {
  storageMode = { folderName: null, ...mode };
  return storageMode;
};

/**
 * Pick the store the notebook runs on, once, before the app renders.
 *
 * Three answers, in the order the notebook prefers them:
 *
 * 1. **A folder the user picked** (adapter two, `folder-storage.js`) — when one
 *    was chosen and its permission is still granted, the notes are real `.md`
 *    files in that folder. A handle that is missing, refused or unreadable is
 *    not an error: the notebook opens on the browser store and the Storage
 *    panel offers to reconnect.
 * 2. **IndexedDB** — the notebook's own store (slice 2). Web Storage is the
 *    fallback for a browser that has none or refuses to open one, and it is not
 *    a second class of notebook: the same seam, the same keys, the same
 *    journal. Whatever the notebook left in Web Storage is moved up on boot
 *    (`migrateNotebookToIndexedDb`), so a session spent on the fallback is
 *    picked up by the next session on the real store.
 */
export const initializeStorage = async () => {
  if (folderStorageAvailable()) {
    try {
      const folder = await connectSavedFolder();
      if (folder) {
        defaultAdapter = folder.adapter;
        setStorageMode({ mode: 'folder', folderName: folder.name });
        if (import.meta.env.DEV) console.info('Storage initialized: folder', folder.name);
        return folder.adapter;
      }
    } catch (error) {
      console.warn('Notes folder unavailable, using the browser store:', error);
    }
  }

  const indexedDbAdapter = createIndexedDbAdapter();

  try {
    await indexedDbAdapter.initialize();
    const migration = await migrateNotebookToIndexedDb(indexedDbAdapter);
    defaultAdapter = indexedDbAdapter;
    setStorageMode({ mode: 'indexeddb' });
    if (import.meta.env.DEV) console.log('Storage initialized: IndexedDB', migration);
    return indexedDbAdapter;
  } catch (error) {
    const fallback = getStorageAdapter();
    if (import.meta.env.DEV) {
      console.warn('IndexedDB unavailable, using browser localStorage:', error);
    }
    await fallback.initialize();
    setStorageMode({ mode: 'local' });
    return fallback;
  }
};
