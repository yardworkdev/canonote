import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseAuth } from './supabase';
import { notesApi, NotesApiError } from './notes-api';

describe('notesApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(supabaseAuth, 'getSession').mockResolvedValue({ access_token: 'user-token' });
  });

  it('uses only the Supabase user session for canonical notes', async () => {
    localStorage.setItem('agent-api-token', 'agent-token');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [] }),
    });

    await notesApi.list();

    // A save now carries a deadline: a request that never settles would block
    // the serial save queue for the rest of the session.
    expect(fetch).toHaveBeenCalledWith('/api/notes', {
      headers: { Authorization: 'Bearer user-token' },
      signal: expect.any(AbortSignal),
    });
  });

  it('preserves status and response data for conflict handling', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ success: false, error: 'Conflict', currentRevision: '2' }),
    });

    await expect(notesApi.update('note-1', { content: 'draft' })).rejects.toMatchObject({
      name: 'NotesApiError',
      status: 409,
      data: { currentRevision: '2' },
    });
  });

  it('does not turn a missing update into a create request', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ success: false, error: 'Not found' }),
    });

    await expect(notesApi.update('deleted-note', { content: 'draft' })).rejects.toBeInstanceOf(
      NotesApiError
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].method).toBe('PATCH');
  });

  it('search query is URL-encoded in the request', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [] }),
    });

    await notesApi.search('hello world & friends');

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('q=hello+world+%26+friends'),
      expect.any(Object)
    );
  });

  it('create sends POST with correct body shape', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ success: true, data: { id: 'new-note' } }),
    });

    await notesApi.create({ noteId: 'new-note', title: 'Test', content: 'Body' });

    expect(fetch).toHaveBeenCalledWith(
      '/api/notes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ noteId: 'new-note', title: 'Test', content: 'Body' }),
      })
    );
  });

  it('delete sends DELETE with ifRevision in body', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: {} }),
    });

    await notesApi.delete('note-1', '3');

    expect(fetch).toHaveBeenCalledWith(
      '/api/notes/note-1',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ ifRevision: '3' }),
      })
    );
  });

  it('500 response throws NotesApiError with status 500', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: 'Internal error' }),
    });

    await expect(notesApi.list()).rejects.toMatchObject({
      name: 'NotesApiError',
      status: 500,
    });
  });
});
