import { describe, expect, it, vi } from 'vitest';
import {
  describeStorageFailure,
  isStorageBlockedError,
  probeBrowserStorage,
  probeStorageAdapter,
  storageUnavailableError,
  STORAGE_UNAVAILABLE,
} from './storage-failure';

// A browser that refuses to store anything used to look like a working notebook
// while losing every keystroke, so the vocabulary about failing writes is pinned
// here: which failure it is, and what the user is told about it.
describe('the browser refusing to store', () => {
  const refusingStore = (error) => ({
    setItem: () => {
      throw error;
    },
    removeItem: vi.fn(),
  });

  it('reports a store that accepts a write as available', () => {
    const setItem = vi.fn();
    const removeItem = vi.fn();

    expect(probeBrowserStorage({ setItem, removeItem })).toEqual({
      available: true,
      reason: null,
    });
    expect(setItem).toHaveBeenCalledTimes(1);
    // The probe must not leave its own key behind.
    expect(removeItem).toHaveBeenCalledTimes(1);
  });

  it('reports a blocked store, a full store and a missing store distinctly', () => {
    expect(
      probeBrowserStorage(refusingStore(new DOMException('denied', 'SecurityError')))
    ).toEqual({ available: false, reason: 'blocked' });
    expect(
      probeBrowserStorage(refusingStore(new DOMException('full', 'QuotaExceededError')))
    ).toEqual({ available: false, reason: 'full' });
    expect(probeBrowserStorage(null)).toEqual({ available: false, reason: 'blocked' });
  });

  it('marks the error the adapter throws when there is no store at all', () => {
    const error = storageUnavailableError('note-default');

    expect(error.code).toBe(STORAGE_UNAVAILABLE);
    expect(error.message).toMatch(/storage is unavailable/i);
    expect(isStorageBlockedError(error)).toBe(true);
  });

  it('describes a blocked store with a recovery step and no pointless retry', () => {
    const message = describeStorageFailure(storageUnavailableError('note-default'));

    // The step that can actually help...
    expect(message).toMatch(/allow site data/i);
    // ...and never the instruction the browser will refuse again.
    expect(message).not.toMatch(/retry/i);
  });

  it('describes a full store and an unknown failure with their own messages', () => {
    const full = Object.assign(new Error('nope'), { name: 'QuotaExceededError' });

    expect(describeStorageFailure(full)).toMatch(/storage is full/i);
    expect(describeStorageFailure(full)).toMatch(/export your notes/i);
    expect(describeStorageFailure(new Error('boom'))).toMatch(/failed to save note/i);
  });
});

// The row asks the store the notes are on, not Web Storage: after the notes
// moved to IndexedDB a browser can block one store and allow the other, and the
// answer has to be about the store the app is really using.
describe('the seam probe', () => {
  it('reports the store the app is on as available, and clears its probe key', async () => {
    const set = vi.fn(async () => {});
    const remove = vi.fn(async () => {});

    expect(await probeStorageAdapter({ set, delete: remove })).toEqual({
      available: true,
      reason: null,
    });
    expect(set).toHaveBeenCalledTimes(1);
    // The probe must not leave its own key behind.
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('reports a blocked store, a full store and a missing store distinctly', async () => {
    const refusing = (error) => ({
      set: async () => {
        throw error;
      },
      delete: vi.fn(),
    });

    expect(
      await probeStorageAdapter(refusing(new DOMException('denied', 'SecurityError')))
    ).toEqual({ available: false, reason: 'blocked' });
    expect(
      await probeStorageAdapter(refusing(new DOMException('full', 'QuotaExceededError')))
    ).toEqual({ available: false, reason: 'full' });
    expect(await probeStorageAdapter(null)).toEqual({ available: false, reason: 'blocked' });
  });
});
