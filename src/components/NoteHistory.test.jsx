import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NoteHistory from './NoteHistory';
import { NOTE_VERSIONS_EVENT } from '../services/note-history';

// The History panel is one of four helper panels and the only one that reads
// the store, so it is where "no versions" and "the read failed" were the same
// screen. Each state it can be in is pinned here.

const version = (id, timestamp, content) => ({
  id,
  content,
  timestamp,
  wordCount: 4,
  charCount: content.length,
});

const makeStorage = (versionsByNote = {}) => ({
  scopedKey: (key) => `local:${key}`,
  get: vi.fn(async (key) => {
    const noteId = key.replace('local:note-versions:', '');
    const versions = versionsByNote[noteId];
    return versions ? { value: JSON.stringify(versions) } : null;
  }),
  set: vi.fn(async () => true),
});

describe('NoteHistory', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says a note has no versions yet', async () => {
    render(<NoteHistory noteId="note-1" content="" storage={makeStorage()} />);

    expect(
      await screen.findByText('No versions saved yet — versions are recorded as you edit.')
    ).toBeInTheDocument();
    expect(screen.getByText('0 versions saved')).toBeInTheDocument();
  });

  it('lists the versions and counts them in its header', async () => {
    const storage = makeStorage({
      'note-1': [version('v-2', 2000, 'the newer body'), version('v-1', 1000, 'the older body')],
    });

    render(<NoteHistory noteId="note-1" content="" storage={storage} />);

    expect(await screen.findByText('2 versions saved')).toBeInTheDocument();
    expect(screen.getByText(/the newer body/)).toBeInTheDocument();
    expect(screen.getByText(/the older body/)).toBeInTheDocument();
  });

  it('reports a read the store refused instead of claiming there is nothing', async () => {
    const storage = makeStorage();
    storage.get.mockImplementation(async () => {
      throw new DOMException('Access to storage is not allowed.', 'SecurityError');
    });

    render(<NoteHistory noteId="note-1" content="" storage={storage} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This note's versions could not be read."
    );
    expect(screen.queryByText(/No versions saved yet/)).toBeNull();
    expect(screen.getByText('Versions could not be read')).toBeInTheDocument();

    // The step on offer really re-reads: the next attempt succeeds.
    storage.get.mockResolvedValue({ value: JSON.stringify([version('v-1', 1000, 'back again')]) });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('1 version saved')).toBeInTheDocument();
    expect(screen.getByText(/back again/)).toBeInTheDocument();
  });

  it('says a version could not be deleted and keeps the list it still has', async () => {
    const storage = makeStorage({ 'note-1': [version('v-1', 1000, 'the only body')] });
    storage.set.mockImplementation(async () => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<NoteHistory noteId="note-1" content="" storage={storage} />);
    await screen.findByText('1 version saved');

    fireEvent.click(screen.getByTitle('Delete version'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That version could not be deleted.'
    );
    expect(screen.getByText('The browser refused the write, so nothing was removed.')).toBeInTheDocument();
    // The store kept it, so the list must still show it.
    expect(screen.getByText(/the only body/)).toBeInTheDocument();
    expect(screen.getByText('1 version saved')).toBeInTheDocument();
  });

  it('says the store is the reason when it cannot be written to at all', async () => {
    // A browser that blocks site data answers null for every read, so an empty
    // read is not evidence of an empty history. The panel asks the store, and
    // states the storage failure with its own step.
    const storage = {
      scopedKey: (key) => `local:${key}`,
      get: vi.fn(async () => null),
      set: vi.fn(async () => {
        throw new DOMException('Access to storage is not allowed.', 'SecurityError');
      }),
      delete: vi.fn(async () => {}),
    };

    render(<NoteHistory noteId="note-1" content="" storage={storage} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Versions cannot be read — this browser is blocking storage.'
    );
    expect(screen.getByText('Allow site data for this page, then reload.')).toBeInTheDocument();
    expect(screen.queryByText(/No versions saved yet/)).toBeNull();
  });

  it('picks up a version the save pipeline records while it is on screen', async () => {
    const storage = makeStorage();
    render(<NoteHistory noteId="note-1" content="" storage={storage} />);
    await screen.findByText('No versions saved yet — versions are recorded as you edit.');

    // The pipeline records the snapshot and announces it; the panel re-reads.
    storage.get.mockResolvedValue({
      value: JSON.stringify([version('v-1', 1000, 'a body written after the panel opened')]),
    });
    window.dispatchEvent(
      new CustomEvent(NOTE_VERSIONS_EVENT, { detail: { noteId: 'note-1' } })
    );

    expect(await screen.findByText('1 version saved')).toBeInTheDocument();
    expect(screen.getByText(/a body written after the panel opened/)).toBeInTheDocument();
  });

  it('ignores a version recorded for another note', async () => {
    const storage = makeStorage();
    render(<NoteHistory noteId="note-1" content="" storage={storage} />);
    await screen.findByText('No versions saved yet — versions are recorded as you edit.');

    storage.get.mockResolvedValue({
      value: JSON.stringify([version('v-9', 1000, 'another note body')]),
    });
    window.dispatchEvent(
      new CustomEvent(NOTE_VERSIONS_EVENT, { detail: { noteId: 'note-2' } })
    );

    await waitFor(() => expect(storage.get).toHaveBeenCalledTimes(1));
    expect(screen.getByText('0 versions saved')).toBeInTheDocument();
  });

  it('does not let a slower read of another note land over a newer one', async () => {
    let resolveFirst;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const storage = {
      scopedKey: (key) => `local:${key}`,
      get: vi.fn(async (key) => {
        if (key.includes('note-versions:note-a')) return first;
        return { value: JSON.stringify([version('v-b', 2000, 'body of note b')]) };
      }),
      set: vi.fn(async () => true),
    };

    const { rerender } = render(<NoteHistory noteId="note-a" content="" storage={storage} />);
    rerender(<NoteHistory noteId="note-b" content="" storage={storage} />);

    expect(await screen.findByText(/body of note b/)).toBeInTheDocument();

    resolveFirst({ value: JSON.stringify([version('v-a', 1000, 'body of note a')]) });

    await waitFor(() => expect(screen.queryByText(/body of note a/)).toBeNull());
    expect(screen.getByText('1 version saved')).toBeInTheDocument();
  });
});
