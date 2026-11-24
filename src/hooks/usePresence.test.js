import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// An agent has no tab to broadcast into, so the only way an open editor learns
// that it wrote is the presence poll it is already making. These tests pin the
// two halves of that promise: the poll says the revision moved, and it says it
// once per move - not on every tick, and not when the revision goes backwards.

const presence = vi.fn();
const announcePresence = vi.fn();

vi.mock('../services/supabase', () => ({ isSupabaseConfigured: () => true }));
vi.mock('../services/notes-api', () => ({
  notesApi: {
    presence: (...args) => presence(...args),
    announcePresence: (...args) => announcePresence(...args),
  },
}));

const { usePresence } = await import('./usePresence');

describe('the presence poll carries the note revision', () => {
  beforeEach(() => {
    presence.mockReset();
    presence.mockResolvedValue({ ttl: 12000, revision: 5, entries: [] });
    globalThis.BroadcastChannel = class {
      constructor() {
        this.onmessage = null;
      }
      close() {}
      postMessage() {}
    };
  });

  it('announces each move once, and never announces a revision that goes backwards', async () => {
    const seen = [];
    const listener = (event) => seen.push(event.detail.revision);
    window.addEventListener('canonote:remote-revision', listener);

    const { rerender } = renderHook(({ noteId }) => usePresence({ noteId }), {
      initialProps: { noteId: 'note-1' },
    });

    await waitFor(() => expect(seen).toEqual([5]));

    // The same revision on the next tick is not news.
    presence.mockResolvedValue({ ttl: 12000, revision: 5, entries: [] });
    rerender({ noteId: 'note-1' });
    await new Promise((resolve) => setTimeout(resolve, 3200));
    expect(seen).toEqual([5]);

    // An agent wrote: the number moved.
    presence.mockResolvedValue({ ttl: 12000, revision: 6, entries: [] });
    await waitFor(() => expect(seen).toEqual([5, 6]), { timeout: 6000 });

    // A stale answer from an older request must not rewind the editor.
    presence.mockResolvedValue({ ttl: 12000, revision: 4, entries: [] });
    await new Promise((resolve) => setTimeout(resolve, 3200));
    expect(seen).toEqual([5, 6]);

    window.removeEventListener('canonote:remote-revision', listener);
  }, 20000);

  it('says nothing when the server sends no revision', async () => {
    const seen = [];
    const listener = (event) => seen.push(event.detail);
    window.addEventListener('canonote:remote-revision', listener);
    presence.mockResolvedValue({ ttl: 12000, entries: [] });

    renderHook(() => usePresence({ noteId: 'note-2' }));
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(seen).toEqual([]);

    window.removeEventListener('canonote:remote-revision', listener);
  }, 10000);
});

// An agent has no tab, so a caret that only crosses a BroadcastChannel is a caret
// no agent can see. These pin the server half: one request a second at most, the
// last position always lands, and a placeholder note writes nothing.
describe('the person’s caret reaches the server', () => {
  beforeEach(() => {
    announcePresence.mockReset();
    announcePresence.mockResolvedValue({ kind: 'person', from: 0 });
    globalThis.BroadcastChannel = class {
      constructor() {
        this.onmessage = null;
      }
      close() {}
      postMessage() {}
    };
  });

  it('sends a caret at once, then at most once a second, and the last one lands', async () => {
    const { result, rerender } = renderHook(
      ({ caret }) => usePresence({ noteId: 'note-3', caret }),
      { initialProps: { caret: 0 } }
    );

    act(() => result.current.publishCaret(10));
    await waitFor(() => expect(announcePresence).toHaveBeenCalledWith('note-3', { from: 10 }));

    // Three moves inside the same second cost one trailing request, carrying the
    // position the caret ended on - not the one it passed through.
    rerender({ caret: 42 });
    act(() => result.current.publishCaret(20));
    act(() => result.current.publishCaret(30));
    act(() => result.current.publishCaret(42));
    expect(announcePresence).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(announcePresence).toHaveBeenLastCalledWith('note-3', { from: 42 }), {
      timeout: 3000,
    });
    expect(announcePresence).toHaveBeenCalledTimes(2);
  }, 15000);

  it('writes nothing for the placeholder note', async () => {
    const { result } = renderHook(() => usePresence({ noteId: 'note-default', caret: 1 }));
    act(() => result.current.publishCaret(5));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(announcePresence).not.toHaveBeenCalled();
  }, 10000);
});
