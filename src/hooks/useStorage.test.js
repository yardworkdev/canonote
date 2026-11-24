import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStorage } from './useStorage';

describe('useStorage', () => {
  describe('scopedKey', () => {
    it('returns null when user is null', () => {
      const { result } = renderHook(() => useStorage(null));
      expect(result.current.scopedKey('notes-cache')).toBeNull();
    });

    it('returns "userId:key" when user has an id', () => {
      const { result } = renderHook(() => useStorage({ id: 'user-123' }));
      expect(result.current.scopedKey('notes-cache')).toBe('user-123:notes-cache');
    });

    it('returns "undefined:key" when user.id is undefined (documents the bug)', () => {
      const { result } = renderHook(() => useStorage({ id: undefined }));
      expect(result.current.scopedKey('notes-cache')).toBe('undefined:notes-cache');
    });

    it('handles user.id containing special characters', () => {
      const { result } = renderHook(() => useStorage({ id: 'a:b@c' }));
      expect(result.current.scopedKey('key')).toBe('a:b@c:key');
    });
  });

  describe('noteStorageKey', () => {
    it('returns null when user is null', () => {
      const { result } = renderHook(() => useStorage(null));
      expect(result.current.noteStorageKey('note-abc')).toBeNull();
    });

    it('normalizes noteId without "note-" prefix', () => {
      const { result } = renderHook(() => useStorage({ id: 'user-1' }));
      expect(result.current.noteStorageKey('abc')).toBe('user-1:note-abc');
    });

    it('preserves noteId with "note-" prefix', () => {
      const { result } = renderHook(() => useStorage({ id: 'user-1' }));
      expect(result.current.noteStorageKey('note-abc')).toBe('user-1:note-abc');
    });

    it('produces garbage key for null noteId (documents the bug)', () => {
      const { result } = renderHook(() => useStorage({ id: 'user-1' }));
      // null?.startsWith('note-') is undefined (falsy), so else branch runs
      expect(result.current.noteStorageKey(null)).toBe('user-1:note-null');
    });

    it('produces garbage key for undefined noteId (documents the bug)', () => {
      const { result } = renderHook(() => useStorage({ id: 'user-1' }));
      expect(result.current.noteStorageKey(undefined)).toBe('user-1:note-undefined');
    });

    it('two different users produce different keys for the same note', () => {
      const { result: r1 } = renderHook(() => useStorage({ id: 'user-a' }));
      const { result: r2 } = renderHook(() => useStorage({ id: 'user-b' }));
      expect(r1.current.noteStorageKey('note-1')).not.toBe(r2.current.noteStorageKey('note-1'));
    });
  });

  describe('get/set/delete', () => {
    it('get returns the value from window.storage', async () => {
      const mockStorage = {
        get: vi.fn().mockResolvedValue({ value: 'test-value' }),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      };
      // Mock window.storage
      Object.defineProperty(window, 'storage', { value: mockStorage, configurable: true });

      const { result } = renderHook(() => useStorage({ id: 'user-1' }));
      const val = await result.current.get('my-key');
      expect(val).toEqual({ value: 'test-value' });
      expect(mockStorage.get).toHaveBeenCalledWith('my-key');
    });

    it('set writes to window.storage', async () => {
      const mockStorage = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      };
      Object.defineProperty(window, 'storage', { value: mockStorage, configurable: true });

      const { result } = renderHook(() => useStorage({ id: 'user-1' }));
      await result.current.set('my-key', 'my-value');
      expect(mockStorage.set).toHaveBeenCalledWith('my-key', 'my-value');
    });

    it('delete removes from window.storage', async () => {
      const mockStorage = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      };
      Object.defineProperty(window, 'storage', { value: mockStorage, configurable: true });

      const { result } = renderHook(() => useStorage({ id: 'user-1' }));
      await result.current.delete('my-key');
      expect(mockStorage.delete).toHaveBeenCalledWith('my-key');
    });
  });
});
