import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// A thread belongs to one note. Two things can put the wrong conversation on
// screen, and neither is visible to a person:
//
// 1. a slow answer for the note you just left arriving after you switched,
// 2. the previous note's cursor being reused as `since=`, which silently skips
//    every message written on the note now open.
//
// The first is guarded in `useThread` by comparing the note id after the await;
// the second by dropping the cursor when the note changes. These tests fail if
// either guard is removed.

const messages = vi.fn();

vi.mock('../services/supabase', () => ({ isSupabaseConfigured: () => true }));
vi.mock('../services/notes-api', () => ({
  notesApi: { messages: (...args) => messages(...args) },
}));

const { useThread } = await import('./useThread');

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function message(id, noteId, createdAt) {
  return { id, noteId, authorType: 'agent', authorName: 'promi', kind: 'note', body: id, createdAt };
}

describe('the thread never shows another note’s conversation', () => {
  beforeEach(() => {
    messages.mockReset();
  });

  it('drops an answer that arrives for the note you have already left', async () => {
    const slowForA = deferred();
    const fastForB = deferred();

    messages.mockImplementation((noteId) => (noteId === 'note-a' ? slowForA.promise : fastForB.promise));

    const { result, rerender } = renderHook(({ noteId }) => useThread({ noteId }), {
      initialProps: { noteId: 'note-a' },
    });

    rerender({ noteId: 'note-b' });
    fastForB.resolve([message('m-b', 'note-b', '2026-11-12T10:00:00.000Z')]);
    await waitFor(() => expect(result.current.messages.map((entry) => entry.id)).toEqual(['m-b']));

    // The note the person left answers last; it must land nowhere.
    slowForA.resolve([message('m-a', 'note-a', '2026-11-12T09:59:00.000Z')]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.current.messages.map((entry) => entry.id)).toEqual(['m-b']);
  });

  it('asks for the new note from the beginning instead of reusing the old cursor', async () => {
    messages.mockImplementation(async (noteId) => [
      message(`m-${noteId}`, noteId, noteId === 'note-a' ? '2026-11-12T10:00:00.000Z' : '2026-11-12T10:05:00.000Z'),
    ]);

    const { rerender } = renderHook(({ noteId }) => useThread({ noteId }), {
      initialProps: { noteId: 'note-a' },
    });

    await waitFor(() => expect(messages).toHaveBeenCalledWith('note-a', null));

    rerender({ noteId: 'note-b' });
    await waitFor(() => expect(messages).toHaveBeenCalledWith('note-b', null));
  });

  it('replaces a message decided in another tab instead of keeping the old copy', async () => {
    const created = message('m-proposal', 'note-a', '2026-11-12T10:00:00.000Z');
    const decided = { ...created, appliedAt: '2026-11-12T10:04:00.000Z', decidedAt: '2026-11-12T10:04:00.000Z' };

    messages.mockResolvedValueOnce([{ ...created, kind: 'proposal' }]);
    const { result } = renderHook(() => useThread({ noteId: 'note-a' }));

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0].appliedAt).toBeUndefined();

    // The other tab decided it; this poll brings the same row back, changed.
    messages.mockResolvedValueOnce([decided]);
    await act(async () => {
      await result.current.refresh({ initial: false });
    });

    expect(result.current.messages).toHaveLength(1, 'replaced, not appended');
    expect(result.current.messages[0].appliedAt).toBe('2026-11-12T10:04:00.000Z');

    // And the cursor moved to the decision, so the next poll does not re-read it.
    await act(async () => {
      await result.current.refresh({ initial: false });
    });
    expect(messages).toHaveBeenLastCalledWith('note-a', '2026-11-12T10:04:00.000Z');
  });

  it('keeps the cursor within one note, so the next poll asks for what is new', async () => {
    messages.mockResolvedValue([message('m-1', 'note-a', '2026-11-12T10:00:00.000Z')]);

    const { result } = renderHook(() => useThread({ noteId: 'note-a' }));

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    await act(async () => {
      await result.current.refresh({ initial: false });
    });
    await waitFor(() => expect(messages).toHaveBeenLastCalledWith('note-a', '2026-11-12T10:00:00.000Z'));
  });
});
