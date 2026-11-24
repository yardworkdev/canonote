import { describe, it, expect, vi } from 'vitest';
import {
  createLocalStorageAdapter,
  freezeStorageAdapter,
  toCompatibleStorageAdapter,
} from './browser-storage';
import { getStorageAdapter, initializeStorage } from './storage-adapter';

describe('storage-adapter', () => {
  describe('getStorageAdapter', () => {
    it('returns a singleton adapter', () => {
      const a = getStorageAdapter();
      const b = getStorageAdapter();
      expect(a).toBe(b);
    });

    it('returned adapter has get/set/delete methods', () => {
      const adapter = getStorageAdapter();
      expect(typeof adapter.get).toBe('function');
      expect(typeof adapter.set).toBe('function');
      expect(typeof adapter.delete).toBe('function');
    });
  });

  describe('initializeStorage', () => {
    it('returns the adapter with the seam surface', async () => {
      const adapter = await initializeStorage();
      expect(adapter).toBeDefined();
      expect(typeof adapter.get).toBe('function');
      expect(typeof adapter.entries).toBe('function');
    });

    it('falls back to Web Storage when the browser has no IndexedDB', async () => {
      // jsdom has no IndexedDB at all, which is exactly the browser this
      // fallback exists for; the IndexedDB path is proven in a real browser by
      // tests/indexeddb-store.spec.js.
      const adapter = await initializeStorage();
      expect(await adapter.initialize()).toMatchObject({ mode: 'local' });
    });
  });

  describe('createLocalStorageAdapter', () => {
    // Use a real in-memory map to simulate localStorage behavior
    const store = new Map();
    const realLocalStorage = {
      getItem: vi.fn((key) => store.get(key) ?? null),
      setItem: vi.fn((key, value) => { store.set(key, value); }),
      removeItem: vi.fn((key) => { store.delete(key); }),
    };

    beforeEach(() => {
      store.clear();
      vi.clearAllMocks();
      Object.defineProperty(window, 'localStorage', { value: realLocalStorage, configurable: true });
    });

    it('get returns null for missing key', async () => {
      const adapter = createLocalStorageAdapter();
      const result = await adapter.get('nonexistent-key');
      expect(result).toBeNull();
    });

    it('set then get returns the value', async () => {
      const adapter = createLocalStorageAdapter();
      await adapter.set('test-key', 'test-value');
      const result = await adapter.get('test-key');
      expect(result).toEqual({ value: 'test-value' });
    });

    it('set throws when localStorage is unavailable', async () => {
      Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true });
      const adapter = createLocalStorageAdapter();
      await expect(adapter.set('key', 'value')).rejects.toThrow('Browser storage is unavailable');
    });

    it('delete removes the key', async () => {
      const adapter = createLocalStorageAdapter();
      await adapter.set('del-key', 'value');
      await adapter.delete('del-key');
      const result = await adapter.get('del-key');
      expect(result).toBeNull();
    });
  });

  describe('freezeStorageAdapter', () => {
    it('prevents property reassignment on the returned object', () => {
      const adapter = createLocalStorageAdapter();
      const frozen = freezeStorageAdapter(adapter);
      expect(() => { frozen.get = vi.fn(); }).toThrow();
    });

    it('still allows calling the original methods', async () => {
      const adapter = createLocalStorageAdapter();
      const frozen = freezeStorageAdapter(adapter);
      await frozen.set('frozen-key', 'value');
      const result = await frozen.get('frozen-key');
      expect(result).toEqual({ value: 'value' });
      await frozen.delete('frozen-key');
    });
  });

  describe('toCompatibleStorageAdapter', () => {
    it('returns null for incompatible objects', () => {
      expect(toCompatibleStorageAdapter(null)).toBeNull();
      expect(toCompatibleStorageAdapter(42)).toBeNull();
      expect(toCompatibleStorageAdapter('string')).toBeNull();
    });

    it('normalizes objects with get/set functions', () => {
      const candidate = {
        get: vi.fn().mockResolvedValue({ value: 'x' }),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      };
      const adapter = toCompatibleStorageAdapter(candidate);
      expect(adapter).not.toBeNull();
      expect(typeof adapter.get).toBe('function');
    });

    it('normalizes localStorage-like objects with getItem/setItem/removeItem', () => {
      const candidate = {
        getItem: vi.fn().mockReturnValue('val'),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      };
      const adapter = toCompatibleStorageAdapter(candidate);
      expect(adapter).not.toBeNull();
    });

    it('handles object with get/set but no delete', () => {
      const candidate = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
      };
      const adapter = toCompatibleStorageAdapter(candidate);
      expect(adapter).not.toBeNull();
      // delete should be a no-op function
      expect(typeof adapter.delete).toBe('function');
    });

    it('returns null for objects with only getItem but no setItem', () => {
      const candidate = { getItem: vi.fn() };
      expect(toCompatibleStorageAdapter(candidate)).toBeNull();
    });
  });
});
