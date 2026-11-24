import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalStorageAdapter,
  measureStorageEntries,
  readBrowserStorageEntries,
  readBrowserStorageJson,
  readBrowserStorageValue,
  toCompatibleStorageAdapter,
  writeBrowserStorageJson,
  writeBrowserStorageValue,
} from './browser-storage';

// A Web Storage that behaves like the real thing (length/key/item), which the
// mocked localStorage in test-setup deliberately does not: the seam enumerates
// its own keys now, so a mock that cannot be enumerated would make every test
// about the scan pass by accident.
const createWebStorageDouble = () => {
  const map = new Map();
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
    clear: () => map.clear(),
  };
};

const withWebStorage = async (run) => {
  const original = window.localStorage;
  const double = createWebStorageDouble();
  Object.defineProperty(window, 'localStorage', {
    value: double,
    configurable: true,
    writable: true,
  });
  try {
    return await run(double);
  } finally {
    Object.defineProperty(window, 'localStorage', {
      value: original,
      configurable: true,
      writable: true,
    });
  }
};

describe('browser storage helpers', () => {
  let store;

  beforeEach(() => {
    store = new Map();
    window.localStorage.getItem.mockImplementation((key) =>
      store.has(key) ? store.get(key) : null
    );
    window.localStorage.setItem.mockImplementation((key, value) => {
      store.set(key, value);
    });
    window.localStorage.removeItem.mockImplementation((key) => {
      store.delete(key);
    });
    window.localStorage.clear.mockImplementation(() => {
      store.clear();
    });
    window.localStorage.clear();
  });

  it('reads and writes JSON values through browser storage', () => {
    expect(writeBrowserStorageJson('prefs', { theme: 'dark' })).toBe(true);
    expect(readBrowserStorageJson('prefs', null)).toEqual({ theme: 'dark' });
  });

  it('returns the fallback when stored JSON is invalid', () => {
    window.localStorage.setItem('prefs', '{invalid');
    expect(readBrowserStorageJson('prefs', { theme: 'light' })).toEqual({ theme: 'light' });
  });

  it('preserves intentionally empty strings in the local storage adapter', async () => {
    const adapter = createLocalStorageAdapter();
    await adapter.set('empty-note', '');

    await expect(adapter.get('empty-note')).resolves.toEqual({ value: '' });
  });

  it('normalizes localStorage-compatible adapters without treating empty strings as missing', async () => {
    const compatible = toCompatibleStorageAdapter({
      getItem: vi.fn((key) => (key === 'empty-note' ? '' : null)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });

    await expect(compatible.get('empty-note')).resolves.toEqual({ value: '' });
  });

  it('readBrowserStorageJson returns fallback for empty string value (documents the bug)', () => {
    window.localStorage.setItem('empty-key', '');
    // Empty string is falsy, so readBrowserStorageValue returns '' which is falsy,
    // so readBrowserStorageJson returns the fallback instead of trying JSON.parse('')
    expect(readBrowserStorageJson('empty-key', { default: true })).toEqual({ default: true });
  });

  it('readBrowserStorageValue returns null when localStorage throws', () => {
    window.localStorage.getItem.mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(readBrowserStorageValue('any-key')).toBeNull();
  });

  it('writeBrowserStorageValue returns false when localStorage throws', () => {
    window.localStorage.setItem.mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(writeBrowserStorageValue('key', 'value')).toBe(false);
  });
});

describe('the seam surface the store swap depends on', () => {
  it('enumerates what it holds, so a scan does not have to know the store', async () => {
    await withWebStorage(async () => {
      const adapter = createLocalStorageAdapter();
      await adapter.set('local:note-1', '# One');
      await adapter.set('local:note-2', '# Two');

      await expect(adapter.keys()).resolves.toEqual(['local:note-1', 'local:note-2']);
      await expect(adapter.entries()).resolves.toEqual([
        ['local:note-1', '# One'],
        ['local:note-2', '# Two'],
      ]);
    });
  });

  it('writes several pairs and removes the listed ones in one call', async () => {
    await withWebStorage(async (storage) => {
      storage.setItem('local:note-draft:note-1', '{"content":"old"}');
      const adapter = createLocalStorageAdapter();

      await adapter.setMany([['local:note-1', '# One']], {
        remove: ['local:note-draft:note-1'],
      });

      await expect(adapter.get('local:note-1')).resolves.toEqual({ value: '# One' });
      await expect(adapter.get('local:note-draft:note-1')).resolves.toBeNull();
    });
  });

  it('measures in the unit a browser counts, and null — not 0 — when it cannot', async () => {
    await withWebStorage(async () => {
      const adapter = createLocalStorageAdapter();
      await adapter.set('ab', 'cde');

      // (2 + 3) key plus value, in UTF-16 code units.
      await expect(adapter.measure()).resolves.toBe(10);
    });

    expect(measureStorageEntries([['ab', 'cde']])).toBe(10);
    expect(readBrowserStorageEntries(null)).toEqual([]);
    expect(measureStorageEntries(null)).toBeNull();
  });

  it('carries the optional methods through the adapter normalizer', async () => {
    const compatible = toCompatibleStorageAdapter({
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      entries: vi.fn(async () => [['k', 'v']]),
      keys: vi.fn(async () => ['k']),
      measure: vi.fn(async () => 4),
      setMany: vi.fn(async () => {}),
    });

    await expect(compatible.entries()).resolves.toEqual([['k', 'v']]);
    await expect(compatible.keys()).resolves.toEqual(['k']);
    await expect(compatible.measure()).resolves.toBe(4);
    await compatible.setMany([['k', 'v']], { remove: [] });
    expect(compatible.entries).toBeDefined();
  });

  it('normalizes a Web Storage object and keeps the enumeration with it', async () => {
    const double = createWebStorageDouble();
    double.setItem('local:note-1', '# One');
    const compatible = toCompatibleStorageAdapter(double);

    await expect(compatible.get('local:note-1')).resolves.toEqual({ value: '# One' });
    await expect(compatible.keys()).resolves.toEqual(['local:note-1']);
    await expect(compatible.measure()).resolves.toBe(
      ('local:note-1'.length + '# One'.length) * 2
    );
    await compatible.setMany([['local:note-2', '# Two']], { remove: ['local:note-1'] });
    expect(double.getItem('local:note-2')).toBe('# Two');
    expect(double.getItem('local:note-1')).toBeNull();
  });
});
