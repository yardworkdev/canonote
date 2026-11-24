import { useMemo, useCallback } from 'react';
export {
  getBrowserStorage,
  readBrowserStorageValue,
  writeBrowserStorageValue,
  removeBrowserStorageValue,
} from '../services/browser-storage';

export const useStorage = (user) => {
  const scopedKey = useMemo(() => (key) => (user ? `${user.id}:${key}` : null), [user]);

  const noteStorageKey = useMemo(
    () => (noteId) => {
      if (!user) return null;
      const normalizedId = noteId?.startsWith('note-') ? noteId : `note-${noteId}`;
      return `${user.id}:${normalizedId}`;
    },
    [user]
  );

  const get = useCallback(async (key) => window.storage.get(key), []);
  const set = useCallback(async (key, value) => window.storage.set(key, value), []);
  const remove = useCallback(async (key) => window.storage.delete(key), []);

  return useMemo(
    () => ({
      scopedKey,
      noteStorageKey,
      get,
      set,
      delete: remove,
    }),
    [
      scopedKey,
      noteStorageKey,
      get,
      set,
      remove,
    ]
  );
};
