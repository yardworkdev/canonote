import { beforeEach, describe, expect, it, vi } from 'vitest';

const req = ({ method = 'POST', path = 'note-1/revert', body = { revision: 'rev-old' } } = {}) => ({
  method,
  url: `/api/notes/${path}`,
  query: { path },
  headers: { authorization: 'Bearer user-token' },
  body,
});

const res = () => ({
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
});

/** Found by the version lookup, then by the note lookup, then by the update. */
function client({ version = null, note = null, updated = null } = {}) {
  const chain = (result) => {
    const q = {
      select: () => q,
      eq: () => q,
      is: () => q,
      order: () => q,
      limit: () => Promise.resolve(result),
      maybeSingle: () => Promise.resolve(result),
      single: () => Promise.resolve(result),
      then: (resolve) => Promise.resolve(result).then(resolve),
    };
    return q;
  };

  const versions = chain({ data: version, error: null });
  const notes = chain({ data: note ? [note] : [], error: null });
  const update = vi.fn(() => chain({ data: updated, error: null }));

  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })) },
    from: vi.fn((table) => {
      if (table === 'note_versions') return versions;
      if (table === 'agent_connections') return chain({ data: [], error: null });
      return Object.assign(notes, { update });
    }),
    update,
  };
}

async function load(db) {
  vi.resetModules();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service-key';
  vi.doMock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => db) }));
  const { handleNotes } = await import('../../api/_lib/notes-handler.js');
  return handleNotes;
}

const currentNote = {
  note_id: 'note-1',
  user_id: 'user-1',
  title: 'Deploy checks',
  content: 'the agent rewrote this',
  version: 7,
  is_pinned: false,
  folder: 'private',
  agent_access: true,
  created_at: '2026-11-01T10:00:00.000Z',
  updated_at: '2026-11-09T10:00:00.000Z',
};

describe('reverting to a server version', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('writes the old text back as a new version, guarded by the current one', async () => {
    const db = client({
      version: { revision: 'rev-old', title: 'Deploy checks', content: 'the text before the agent' },
      note: currentNote,
      updated: { ...currentNote, content: 'the text before the agent', version: 8 },
    });
    const handleNotes = await load(db);
    const response = res();

    await handleNotes(req(), response);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.content).toBe('the text before the agent');
    expect(db.update).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'the text before the agent' })
    );
    expect(response.headers.ETag).toBe(`"${response.body.data.revision}"`);
  });

  it('answers 404 for a revision that is not in this note\u2019s history', async () => {
    const handleNotes = await load(client({ version: null, note: currentNote }));
    const response = res();

    await handleNotes(req({ body: { revision: 'rev-nope' } }), response);

    expect(response.statusCode).toBe(404);
    expect(response.body.error).toMatch(/version/i);
  });

  it('rejects a body without a revision instead of reverting to nothing', async () => {
    const handleNotes = await load(client({ version: null, note: currentNote }));
    const response = res();

    await handleNotes(req({ body: {} }), response);

    expect(response.statusCode).toBe(400);
    expect(response.body.field).toBe('revision');
  });

  it('does not touch a note the user cannot see', async () => {
    const db = client({
      version: { revision: 'rev-old', content: 'old text' },
      note: null,
    });
    const handleNotes = await load(db);
    const response = res();

    await handleNotes(req(), response);

    expect(response.statusCode).toBe(404);
    expect(db.update).not.toHaveBeenCalled();
  });
});
