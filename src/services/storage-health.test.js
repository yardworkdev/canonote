import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  describeBrowserQuota,
  describeLocalUsage,
  formatBytes,
  measureStoreBytes,
  readStorageUsage,
} from './storage-health';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('formatBytes', () => {
  it('reads in the unit a person uses', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 kB');
    expect(formatBytes(1536 * 1024)).toBe('1.5 MB');
    expect(formatBytes(150 * 1024)).toBe('150 kB');
  });

  it('answers a dash for a number it does not have', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });
});

describe('measureStoreBytes', () => {
  it('reads the size the seam reports', async () => {
    expect(await measureStoreBytes({ measure: async () => 2048 })).toBe(2048);
    expect(await measureStoreBytes({ measure: async () => 0 })).toBe(0);
  });

  it('answers null when there is no store, no measurement, or a refusal', async () => {
    expect(await measureStoreBytes(null)).toBeNull();
    expect(await measureStoreBytes({})).toBeNull();
    expect(
      await measureStoreBytes({
        measure: async () => {
          throw new DOMException('denied', 'SecurityError');
        },
      })
    ).toBeNull();
    expect(await measureStoreBytes({ measure: async () => NaN })).toBeNull();
  });
});

describe('readStorageUsage', () => {
  it('reads the browser estimate when there is one', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: vi.fn(async () => ({ usage: 2048, quota: 4096 })) },
    });
    expect(await readStorageUsage()).toEqual({ usageBytes: 2048, quotaBytes: 4096 });
  });

  it('answers nulls when the browser will not say', async () => {
    vi.stubGlobal('navigator', {});
    expect(await readStorageUsage()).toEqual({ usageBytes: null, quotaBytes: null });

    vi.stubGlobal('navigator', {
      storage: {
        estimate: vi.fn(async () => {
          throw new Error('not granted');
        }),
      },
    });
    expect(await readStorageUsage()).toEqual({ usageBytes: null, quotaBytes: null });

    vi.stubGlobal('navigator', { storage: { estimate: vi.fn(async () => ({})) } });
    expect(await readStorageUsage()).toEqual({ usageBytes: null, quotaBytes: null });
  });
});

describe('the sentences the panel shows', () => {
  it('states the notes and the space they take', () => {
    expect(describeLocalUsage(2048, 1)).toBe('1 note, about 2 kB in this browser');
    expect(describeLocalUsage(4096, 7)).toBe('7 notes, about 4 kB in this browser');
  });

  it('says so when the browser will not report the size', () => {
    expect(describeLocalUsage(null, 7)).toMatch(/will not report/);
  });

  it('states the room the browser allows, and only when it has a number', () => {
    expect(describeBrowserQuota({ quotaBytes: 4096 })).toBe('up to 4 kB');
    // No usage figure is stated: it counts the whole origin, which is a
    // different quantity from the measured store shown beside it.
    expect(describeBrowserQuota({ usageBytes: 9999 })).toBeNull();
    expect(describeBrowserQuota({ quotaBytes: 0 })).toBeNull();
    expect(describeBrowserQuota({})).toBeNull();
  });
});
