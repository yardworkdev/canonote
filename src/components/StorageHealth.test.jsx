import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StorageHealth from './StorageHealth';
import { BACKUP_INDEX_KEY, backupStorageKey } from '../services/local-backups';

const storage = {
  noteStorageKey: (id) => `local:${id}`,
  scopedKey: (key) => `local:${key}`,
};

const notes = [{ id: 'note-1', title: 'Alpha', updated: 1000 }];

// The unit setup mocks `window.localStorage` with stubs, so the panel is given
// a real in-memory store — the same four primitives a browser store exposes.
const createStore = () => {
  const map = new Map();
  return {
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
    has: (key) => map.has(key),
  };
};

let store;

const seedBackup = (id, createdAt, snapshotNotes) => {
  store.setItem(
    BACKUP_INDEX_KEY,
    JSON.stringify([{ id, createdAt, noteCount: snapshotNotes.length, bytes: 10 }])
  );
  store.setItem(
    backupStorageKey(id),
    JSON.stringify({ schemaVersion: 1, createdAt, notes: snapshotNotes })
  );
};

const renderPanel = (props = {}) => {
  const onClose = vi.fn();
  const onNotice = vi.fn();
  const onRestored = vi.fn();
  const onBackupWritten = vi.fn();
  const result = render(
    <StorageHealth
      isOpen
      onClose={onClose}
      notes={notes}
      storage={storage}
      store={store}
      onNotice={onNotice}
      onRestored={onRestored}
      onBackupWritten={onBackupWritten}
      onExportAll={vi.fn()}
      {...props}
    />
  );
  return { ...result, onClose, onNotice, onRestored, onBackupWritten };
};

describe('StorageHealth', () => {
  beforeEach(() => {
    store = createStore();
    window.storage = {
      get: vi.fn(async (key) => ({ value: key === 'local:note-1' ? '# Alpha' : '' })),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      // The measured store comes through the seam, not from Web Storage.
      measure: vi.fn(async () => 0),
    };
  });

  afterEach(() => {
    delete window.storage;
  });

  it('states where the notes live and that no backup exists yet', async () => {
    renderPanel();

    expect(screen.getByRole('dialog', { name: 'Storage' })).toBeTruthy();
    expect(screen.getByText('In this browser, on this device')).toBeTruthy();
    // The measured store arrives through the seam, so it settles a tick later.
    expect(await screen.findByText('1 note, about 0 B in this browser')).toBeTruthy();
    expect(screen.getByText('No backup taken yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: /restore latest backup/i }).disabled).toBe(true);
  });

  it('backs the notebook up on demand and says what it wrote', async () => {
    const { onNotice, onBackupWritten } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /back up now/i }));

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Backed up 1 note.', 'success'));
    expect(onBackupWritten).toHaveBeenCalled();
    expect(JSON.parse(store.getItem(BACKUP_INDEX_KEY))).toHaveLength(1);
    expect(screen.getByText(/^just now — 1 note$/)).toBeTruthy();
  });

  it('restores the notes the notebook lost, and nothing else', async () => {
    seedBackup('1000', Date.now() - 60_000, [
      { id: 'note-1', title: 'Alpha', content: '# Alpha' },
      { id: 'note-9', title: 'Gone', content: '# Gone' },
    ]);
    const { onNotice, onRestored, onClose } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /restore latest backup/i }));

    await waitFor(() => expect(onRestored).toHaveBeenCalled());
    expect(onRestored.mock.calls[0][0].map((note) => note.id)).toEqual(['note-9']);
    expect(window.storage.set).toHaveBeenCalledWith('local:note-9', '# Gone');
    expect(onNotice.mock.calls[0][0]).toMatch(/^Restored 1 note from the backup taken/);
    expect(onClose).toHaveBeenCalled();
  });

  it('says when there is nothing to restore', async () => {
    seedBackup('1000', Date.now(), [{ id: 'note-1', title: 'Alpha', content: '# Alpha' }]);
    const { onNotice, onRestored } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /restore latest backup/i }));

    await waitFor(() => expect(onNotice).toHaveBeenCalled());
    expect(onNotice.mock.calls[0][0]).toMatch(/^Nothing to restore/);
    expect(onRestored).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const { onClose } = renderPanel();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing when it is closed', () => {
    render(
      <StorageHealth isOpen={false} onClose={vi.fn()} notes={notes} storage={storage} />
    );
    expect(screen.queryByRole('dialog', { name: 'Storage' })).toBeNull();
  });
});
