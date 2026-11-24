import { storageUnavailableError } from './storage-failure';

export const getBrowserStorage = () => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
};

export const readBrowserStorageValue = (key) => {
  const storage = getBrowserStorage();
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

export const writeBrowserStorageValue = (key, value) => {
  const storage = getBrowserStorage();
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

export const removeBrowserStorageValue = (key) => {
  const storage = getBrowserStorage();
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

export const readBrowserStorageJson = (key, fallback = null) => {
  const raw = readBrowserStorageValue(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

export const writeBrowserStorageJson = (key, value) => {
  try {
    return writeBrowserStorageValue(key, JSON.stringify(value));
  } catch {
    return false;
  }
};

/**
 * Every key/value pair the store holds, as `[key, value]` pairs. Reading the
 * whole store is how the notebook finds content whose list row was lost, and
 * how it measures itself — both of those used to reach into `localStorage`
 * directly, which only worked while the store *was* `localStorage`. A store
 * that cannot be read answers `[]` instead of throwing: a notebook with an
 * unreadable store should still open.
 */
export const readBrowserStorageEntries = (storage = getBrowserStorage()) => {
  if (!storage) return [];
  const entries = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key === null || key === undefined) continue;
      const value = storage.getItem(key);
      if (typeof value !== 'string') continue;
      entries.push([key, value]);
    }
  } catch {
    return [];
  }
  return entries;
};

/**
 * The size of a set of pairs in the unit a browser counts: UTF-16 code units,
 * keys and values alike. "About" by nature — a store the browser will not let
 * itself be read answers null rather than 0, because 0 is a claim.
 */
export const measureStorageEntries = (entries) => {
  if (!Array.isArray(entries)) return null;
  return entries.reduce(
    (total, [key, value]) => total + (String(key).length + String(value ?? '').length) * 2,
    0
  );
};

export const createLocalStorageAdapter = () => ({
  async get(key) {
    const storage = getBrowserStorage();
    if (!storage) return null;
    try {
      const value = storage.getItem(key);
      return value === null ? null : { value };
    } catch (error) {
      console.error('Storage get error:', error);
      return null;
    }
  },

  async set(key, value) {
    const storage = getBrowserStorage();
    if (!storage) {
      throw storageUnavailableError(key);
    }
    try {
      storage.setItem(key, value);
    } catch (error) {
      console.error('Storage set error:', error);
      throw error;
    }
  },

  /**
   * Several pairs as one seam call, then the pairs that are done with removed.
   * Web Storage has no transaction, so the order is the guarantee: the writes
   * land first and only then does anything get removed, which is what makes a
   * failed write leave the journal record (and the text) in place.
   */
  async setMany(entries = [], { remove = [] } = {}) {
    const storage = getBrowserStorage();
    if (!storage) {
      throw storageUnavailableError(entries[0]?.[0] ?? remove[0] ?? 'store');
    }
    try {
      for (const [key, value] of entries) storage.setItem(key, value);
      for (const key of remove) storage.removeItem(key);
    } catch (error) {
      console.error('Storage setMany error:', error);
      throw error;
    }
  },

  async delete(key) {
    const storage = getBrowserStorage();
    if (!storage) return;
    try {
      storage.removeItem(key);
    } catch (error) {
      console.error('Storage delete error:', error);
    }
  },

  async entries() {
    return readBrowserStorageEntries();
  },

  async keys() {
    return readBrowserStorageEntries().map(([key]) => key);
  },

  async measure() {
    const storage = getBrowserStorage();
    if (!storage) return null;
    const entries = readBrowserStorageEntries(storage);
    return entries.length === 0 ? 0 : measureStorageEntries(entries);
  },

  async initialize() {
    return {
      mode: 'local',
      message: 'Using browser localStorage for client state',
    };
  },
});

/**
 * The seam the app talks to: `get`, `set`, `delete`, and — when the adapter
 * offers them — `setMany`/`entries`/`keys`/`measure`. The optional surface is
 * carried through rather than dropped, because dropping it is how a store swap
 * turns into a rebuild: the notebook needs to enumerate its own keys, write a
 * save as one unit and measure itself, whichever store it is on.
 */
const SEAM_METHODS = ['setMany', 'entries', 'keys', 'measure'];

export const freezeStorageAdapter = (adapter) => {
  const seam = {
    get: adapter.get,
    set: adapter.set,
    delete: adapter.delete,
  };
  SEAM_METHODS.forEach((name) => {
    if (typeof adapter[name] === 'function') seam[name] = (...args) => adapter[name](...args);
  });
  return Object.freeze(seam);
};

export const toCompatibleStorageAdapter = (candidate) => {
  if (!candidate) return null;

  if (typeof candidate.get === 'function' && typeof candidate.set === 'function') {
    return freezeStorageAdapter({
      get: (...args) => candidate.get(...args),
      set: (...args) => candidate.set(...args),
      delete: (...args) => {
        if (typeof candidate.delete === 'function') return candidate.delete(...args);
        if (typeof candidate.remove === 'function') return candidate.remove(...args);
        if (typeof candidate.removeItem === 'function')
          return Promise.resolve(candidate.removeItem(...args));
        return Promise.resolve();
      },
      setMany:
        typeof candidate.setMany === 'function'
          ? (...args) => candidate.setMany(...args)
          : undefined,
      entries:
        typeof candidate.entries === 'function' ? (...args) => candidate.entries(...args) : undefined,
      keys: typeof candidate.keys === 'function' ? (...args) => candidate.keys(...args) : undefined,
      measure:
        typeof candidate.measure === 'function' ? (...args) => candidate.measure(...args) : undefined,
    });
  }

  if (
    typeof candidate.getItem === 'function' &&
    typeof candidate.setItem === 'function' &&
    typeof candidate.removeItem === 'function'
  ) {
    return freezeStorageAdapter({
      async get(key) {
        try {
          const value = candidate.getItem(key);
          return value === null ? null : { value };
        } catch (error) {
          console.error('Storage get error:', error);
          return null;
        }
      },
      async set(key, value) {
        try {
          candidate.setItem(key, value);
        } catch (error) {
          console.error('Storage set error:', error);
          throw error;
        }
      },
      async setMany(entries = [], { remove = [] } = {}) {
        try {
          for (const [key, value] of entries) candidate.setItem(key, value);
          for (const key of remove) candidate.removeItem(key);
        } catch (error) {
          console.error('Storage setMany error:', error);
          throw error;
        }
      },
      async delete(key) {
        try {
          candidate.removeItem(key);
        } catch (error) {
          console.error('Storage delete error:', error);
        }
      },
      async entries() {
        return readBrowserStorageEntries(candidate);
      },
      async keys() {
        return readBrowserStorageEntries(candidate).map(([key]) => key);
      },
      async measure() {
        const entries = readBrowserStorageEntries(candidate);
        return entries.length === 0 ? 0 : measureStorageEntries(entries);
      },
    });
  }

  return null;
};
