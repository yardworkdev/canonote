import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSaveDebugLogs,
  downloadSaveDebugLogs,
  getSaveDebugLogs,
  logSaveDebug,
} from './saveDebugLogger';

describe('save debug logger', () => {
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

  it('redacts sensitive fields and truncates oversized strings', () => {
    const entry = logSaveDebug('local-save-commit', {
      noteId: 'note-1',
      noteContent: 'secret body',
      apiToken: 'top-secret',
      nested: {
        selectionContent: 'more secret text',
      },
      detail: 'x'.repeat(400),
    });

    expect(entry.payload).toMatchObject({
      noteId: 'note-1',
      noteContent: '[REDACTED]',
      apiToken: '[REDACTED]',
      nested: {
        selectionContent: '[REDACTED]',
      },
    });
    expect(entry.payload.detail).toContain('[truncated]');
    expect(entry.payload.detail.length).toBeLessThan(320);
  });

  it('caps persisted log history to the most recent 500 entries', () => {
    for (let index = 0; index < 510; index += 1) {
      logSaveDebug('event', { index });
    }

    const logs = getSaveDebugLogs();
    expect(logs).toHaveLength(500);
    expect(logs[0].payload.index).toBe(10);
    expect(logs.at(-1).payload.index).toBe(509);
  });

  it('clears and exports persisted logs', () => {
    logSaveDebug('event', { noteId: 'note-1' });

    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:debug-log');
    URL.revokeObjectURL = vi.fn(() => {});
    const appendChild = vi.spyOn(document.body, 'appendChild');
    const removeChild = vi.spyOn(document.body, 'removeChild');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadSaveDebugLogs();

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(appendChild).toHaveBeenCalledTimes(1);
    expect(removeChild).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:debug-log');

    clearSaveDebugLogs();
    expect(getSaveDebugLogs()).toEqual([]);

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    appendChild.mockRestore();
    removeChild.mockRestore();
    click.mockRestore();
  });
});
