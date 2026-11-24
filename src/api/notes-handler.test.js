import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockReq({
  method = 'GET',
  url = '/api/notes',
  query = {},
  headers = {},
  body = null,
} = {}) {
  return {
    method,
    url,
    query,
    headers,
    body,
  };
}

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

async function importHandlerWithClient(client) {
  vi.resetModules();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service-key';
  vi.doMock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => client),
  }));
  return import('../../api/_lib/notes-handler.js');
}

function createNotesClient({ existingNote = null, presenceRows = [] } = {}) {
  const update = vi.fn();
  const agentConnectionsQuery = {
    select: vi.fn(() => agentConnectionsQuery),
    eq: vi.fn(() => agentConnectionsQuery),
    limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
    update: vi.fn(() => agentConnectionsQuery),
  };
  const notesQuery = {
    select: vi.fn(() => notesQuery),
    eq: vi.fn(() => notesQuery),
    is: vi.fn(() => notesQuery),
    order: vi.fn(() => Promise.resolve({ data: [], error: null })),
    limit: vi.fn(() => Promise.resolve({ data: existingNote ? [existingNote] : [], error: null })),
    update,
  };
  const presenceQuery = {
    select: vi.fn(() => presenceQuery),
    eq: vi.fn(() => presenceQuery),
    gte: vi.fn(() => presenceQuery),
    order: vi.fn(() => Promise.resolve({ data: presenceRows, error: null })),
  };

  return {
    auth: {
    getUser: vi.fn(async () => ({
        data: { user: { id: 'user-1', email: 'user@example.com' } },
        error: null,
      })),
    },
    from: vi.fn((table) => {
      if (table === 'agent_connections') return agentConnectionsQuery;
      if (table === 'note_presence') return presenceQuery;
      return notesQuery;
    }),
    notesQuery,
    presenceQuery,
  };
}

function createSearchClient({ titleNotes = [], contentNotes = [] } = {}) {
  const agentQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
    update: vi.fn().mockReturnThis(),
  };

  const makeNoteQuery = (data) => {
    const q = {
      select: vi.fn(() => q),
      eq: vi.fn(() => q),
      is: vi.fn(() => q),
      ilike: vi.fn(() => q),
      order: vi.fn(() => q),
      limit: vi.fn(() => Promise.resolve({ data, error: null })),
    };
    return q;
  };

  const noteQueries = [makeNoteQuery(titleNotes), makeNoteQuery(contentNotes)];
  let noteCallCount = 0;

  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'user-1', email: 'user@example.com' } },
        error: null,
      })),
    },
    from: vi.fn((table) => {
      if (table === 'agent_connections') return agentQuery;
      return noteQueries[noteCallCount++] || makeNoteQuery([]);
    }),
  };
}

describe('notes handler security', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('does not accept user tokens from query params', async () => {
    const client = createNotesClient();
    const { handleNotes } = await importHandlerWithClient(client);
    const req = createMockReq({
      method: 'GET',
      url: '/api/notes?token=user-token',
      query: { token: 'user-token' },
    });
    const res = createMockRes();

    await handleNotes(req, res);

    expect(res.statusCode).toBe(401);
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });

  it('rejects existing-note updates without a revision precondition', async () => {
    const client = createNotesClient({
      existingNote: {
        id: 'row-1',
        user_id: 'user-1',
        note_id: 'note-1',
        title: 'Server note',
        content: 'Server content',
        updated_at: '2026-06-13T10:00:00.000Z',
        version: 4,
      },
    });
    const { handleNotes } = await importHandlerWithClient(client);
    const req = createMockReq({
      method: 'PATCH',
      url: '/api/notes/note-1',
      headers: { authorization: 'Bearer user-token' },
      body: { title: 'Blind overwrite', content: 'Local cache' },
    });
    const res = createMockRes();

    await handleNotes(req, res);

    expect(res.statusCode).toBe(428);
    expect(res.body).toMatchObject({
      success: false,
      currentRevision: '4',
      data: { note_id: 'note-1', content: 'Server content' },
    });
    expect(client.notesQuery.update).not.toHaveBeenCalled();
  });

  it('answers 400, not a crash, for a malformed note id', async () => {
    const client = createNotesClient();
    const { handleNotes } = await importHandlerWithClient(client);
    const req = createMockReq({
      method: 'GET',
      url: '/api/notes/%E0%A4%A',
      headers: { authorization: 'Bearer user-token' },
    });
    const res = createMockRes();

    await handleNotes(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/invalid note id/i);
  });

  it('never echoes a database message in a 500', async () => {
    const client = createNotesClient();
    const leak = 'new row for relation "notes" violates check constraint "notes_folder_check"';
    client.notesQuery.order = vi.fn(() => Promise.resolve({ data: null, error: { message: leak } }));
    const { handleNotes } = await importHandlerWithClient(client);
    const req = createMockReq({ method: 'GET', url: '/api/notes', headers: { authorization: 'Bearer user-token' } });
    const res = createMockRes();

    await handleNotes(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).not.toMatch(/constraint|relation|notes_folder/);
  });
});

describe('notes handler presence', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const ask = async (client, noteId) => {
    const { handleNotes } = await importHandlerWithClient(client);
    const req = createMockReq({
      method: 'GET',
      url: `/api/notes/${noteId}/presence`,
      headers: { authorization: 'Bearer user-token' },
    });
    const res = createMockRes();
    await handleNotes(req, res);
    return res;
  };

  // AGENTS.md, non-negotiable: "404, not 403, for anything withheld. Hidden
  // notes, missing notes, hidden-note presence." The agent route answers 404
  // here; this route is the same promise and used to answer 200 with a null
  // revision, which is the same answer a live note with nobody in it gives.
  it('answers 404 for a note that was never there', async () => {
    const res = await ask(createNotesClient(), 'note-that-does-not-exist');
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: 'Note not found' });
  });

  it('answers 404 for a note switched off for agents', async () => {
    const client = createNotesClient({
      existingNote: { note_id: 'note-1', version: 3, agent_access: false },
    });
    const res = await ask(client, 'note-1');
    expect(res.statusCode).toBe(404);
  });

  it('carries the revision and never shows the person their own caret', async () => {
    const at = new Date().toISOString();
    const client = createNotesClient({
      existingNote: { note_id: 'note-1', version: 7, agent_access: true },
      presenceRows: [
        { kind: 'person', actor_id: 'person', name: 'Me', from_pos: 1, to_pos: 1, at },
        { kind: 'agent', actor_id: 'agent-1', name: 'Promi', mode: 'writing', from_pos: 4, to_pos: 9, at },
      ],
    });
    const res = await ask(client, 'note-1');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.revision).toBe('7');
    expect(res.body.data.entries).toHaveLength(1);
    expect(res.body.data.entries[0]).toMatchObject({ kind: 'agent', id: 'agent-1', from: 4, to: 9 });
  });
});

describe('notes handler search', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns title and content matches with correct matchType and snippet', async () => {
    const titleNote = {
      note_id: 'note-title',
      title: 'Hello World',
      content: '',
      updated_at: '2026-06-13T10:00:00.000Z',
      version: 2,
      is_pinned: false,
      folder: 'private',
    };
    const contentNote = {
      note_id: 'note-content',
      title: 'Untitled',
      content: 'This paragraph contains hello somewhere in the text.',
      updated_at: '2026-06-13T09:00:00.000Z',
      version: 1,
      is_pinned: false,
      folder: 'private',
    };

    const client = createSearchClient({
      titleNotes: [titleNote],
      contentNotes: [contentNote],
    });
    const { handleNotes } = await importHandlerWithClient(client);
    const req = createMockReq({
      method: 'GET',
      url: '/api/notes?q=hello',
      headers: { authorization: 'Bearer user-token' },
      query: { q: 'hello' },
    });
    const res = createMockRes();

    await handleNotes(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);

    const title = res.body.data.find((n) => n.id === 'note-title');
    const content = res.body.data.find((n) => n.id === 'note-content');
    expect(title?.matchType).toBe('title');
    expect(title?.snippet).toBe('');
    expect(content?.matchType).toBe('content');
    expect(content?.snippet).toContain('hello');
  });

  it('deduplicates notes that match both title and content', async () => {
    const both = {
      note_id: 'note-both',
      title: 'hello note',
      content: 'hello in content too',
      updated_at: '2026-06-13T10:00:00.000Z',
      version: 1,
      is_pinned: false,
      folder: 'private',
    };

    const client = createSearchClient({ titleNotes: [both], contentNotes: [both] });
    const { handleNotes } = await importHandlerWithClient(client);
    const req = createMockReq({
      method: 'GET',
      url: '/api/notes?q=hello',
      headers: { authorization: 'Bearer user-token' },
      query: { q: 'hello' },
    });
    const res = createMockRes();

    await handleNotes(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].matchType).toBe('title');
  });
});
