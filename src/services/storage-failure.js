/**
 * What the browser says when it will not store anything, and what to tell the
 * person typing.
 *
 * A store the browser refuses to write (site data blocked, private browsing) is
 * not the same failure as a store with no room left, and a notebook that
 * answers both with "please retry" is telling the user to do something that
 * cannot work. So the reason is answered with a word (`blocked` / `full`, plus
 * the probe's own answer) and each one gets the sentence and the step that
 * fits. `src/services/browser-storage.js` owns the store; this module owns the
 * decision, and `src/services/notices.js` owns the words.
 */
import { noticeText } from './notices';

export const STORAGE_UNAVAILABLE = 'STORAGE_UNAVAILABLE';

export const STORAGE_PROBE_KEY = '__canonote-storage-probe';

export const storageUnavailableError = (key) => {
  const error = new Error(`Browser storage is unavailable for key "${key}".`);
  error.code = STORAGE_UNAVAILABLE;
  return error;
};

export const isStorageBlockedError = (error) => {
  if (error?.code === STORAGE_UNAVAILABLE) return true;
  if (error?.name === 'SecurityError') return true;
  return /storage is unavailable/i.test(error?.message || '');
};

/**
 * One sentence per failure class, recovery step included. The generic retry
 * survives only for failures a retry can clear. The words come from the notice
 * catalog; the decision about which one fits lives here.
 */
export const describeStorageFailure = (error) => {
  if (isStorageBlockedError(error)) {
    return noticeText('storageBlocked');
  }
  if (error?.name === 'QuotaExceededError' || /quota/i.test(error?.message || '')) {
    return noticeText('storageFull');
  }
  return noticeText('saveFailed');
};

/**
 * Ask the browser whether it will actually store something, and why not when it
 * will not: `{ available, reason }` with reason `'blocked'` (no store at all,
 * or a SecurityError) or `'full'` (the store refuses the write for space). The
 * store is passed in so the caller decides which store is being asked.
 *
 * This is the Web Storage form of the question — one synchronous write and
 * delete. The notebook asks its own store the same thing through the seam
 * (`probeStorageAdapter`), because a browser can block one store and allow the
 * other, and the row must answer for the store the notes are actually on.
 */
export const probeBrowserStorage = (storage) => {
  if (!storage) return { available: false, reason: 'blocked' };
  try {
    storage.setItem(STORAGE_PROBE_KEY, '1');
    storage.removeItem(STORAGE_PROBE_KEY);
    return { available: true, reason: null };
  } catch (error) {
    return {
      available: false,
      reason: error?.name === 'QuotaExceededError' ? 'full' : 'blocked',
    };
  }
};

/**
 * The same question, asked of whatever store the app is on: write one probe key
 * through the seam and remove it again. The seam is async and store-agnostic,
 * so the answer is about the store the notes really live in — which is the only
 * answer the status row is allowed to state.
 */
export const probeStorageAdapter = async (adapter) => {
  if (!adapter || typeof adapter.set !== 'function') {
    return { available: false, reason: 'blocked' };
  }
  try {
    await adapter.set(STORAGE_PROBE_KEY, '1');
    await adapter.delete?.(STORAGE_PROBE_KEY);
    return { available: true, reason: null };
  } catch (error) {
    return {
      available: false,
      reason: error?.name === 'QuotaExceededError' ? 'full' : 'blocked',
    };
  }
};
