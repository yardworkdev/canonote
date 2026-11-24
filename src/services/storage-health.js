/**
 * The numbers behind the storage panel: how much the app's own store weighs,
 * what the browser says the whole origin may use, and the sentence for each.
 *
 * Two numbers, kept apart on purpose. `measureStoreBytes` measures the app's
 * store through the seam and is exact-ish (UTF-16 code units, the unit a
 * browser counts); `readStorageUsage` is the browser's own estimate for the
 * whole origin, which includes the service worker, caches and anything else
 * this origin keeps. Adding them together would be a number that means nothing,
 * so the panel states them separately.
 */

/** Byte size in the unit a person reads, one decimal past a kilobyte. */
export const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['kB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
};

/**
 * The notebook's own store, measured: every key with its value, in UTF-16 code
 * units. The measurement comes through the seam (`window.storage.measure()`)
 * rather than from Web Storage, so the number describes the store the notes are
 * really on — once the notes moved to IndexedDB, measuring `localStorage` would
 * have reported an empty notebook while the notes sat one store over. It is
 * "about" by nature: a store that will not report itself answers null rather
 * than 0, because 0 is a claim.
 */
export const measureStoreBytes = async (
  adapter = typeof window !== 'undefined' ? window.storage : null
) => {
  if (!adapter || typeof adapter.measure !== 'function') return null;
  try {
    const bytes = await adapter.measure();
    return Number.isFinite(bytes) ? bytes : null;
  } catch {
    return null;
  }
};

/**
 * What the browser says this origin may use. `navigator.storage.estimate()` is
 * the only API for it and it is not in every browser and not always granted, so
 * an unavailable answer is `{ usageBytes: null, quotaBytes: null }` — the panel
 * then shows the measured store alone rather than a guess.
 */
export const readStorageUsage = async () => {
  const estimate = typeof navigator !== 'undefined' ? navigator.storage?.estimate : null;
  if (typeof estimate !== 'function') return { usageBytes: null, quotaBytes: null };
  try {
    const { usage, quota } = (await estimate.call(navigator.storage)) || {};
    return {
      usageBytes: Number.isFinite(usage) ? usage : null,
      quotaBytes: Number.isFinite(quota) ? quota : null,
    };
  } catch {
    return { usageBytes: null, quotaBytes: null };
  }
};

/** One sentence for the store the app itself keeps. */
export const describeLocalUsage = (localBytes, noteCount) => {
  const notes = `${noteCount} ${noteCount === 1 ? 'note' : 'notes'}`;
  if (localBytes === null) return `${notes} — this browser will not report how much space they take`;
  return `${notes}, about ${formatBytes(localBytes)} in this browser`;
};

/**
 * The room the browser allows this origin, or null when it will not say.
 *
 * Only the quota is stated, never the browser's own `usage` figure: `usage` is
 * the whole origin (service worker, caches, the store), so printing it next to
 * the measured store would put two different quantities in one panel under one
 * heading. The measured store answers "how much is there"; this answers "how
 * much room before the browser says it is full".
 */
export const describeBrowserQuota = ({ quotaBytes }) => {
  if (!Number.isFinite(quotaBytes) || quotaBytes <= 0) return null;
  return `up to ${formatBytes(quotaBytes)}`;
};
