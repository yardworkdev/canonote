import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockReq({
  method = 'GET',
  url = '/api/agent',
  query = {},
  headers = {},
  body = null,
} = {}) {
  return { method, url, query, headers, body };
}

function createMockRes() {
  const res = {
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
  return res;
}

async function importHandlerWithClient(client) {
  vi.resetModules();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service-key';
  process.env.AGENT_API_TOKEN = 'test-agent-token-12345';
  process.env.AGENT_OWNER_USER_ID = 'owner-user-id';
  vi.doMock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => client),
  }));
  return import('../../api/_lib/agent-handler.js');
}

describe('agent-handler', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.AGENT_API_TOKEN;
    delete process.env.AGENT_API_TOKENS;
    delete process.env.AGENT_OWNER_USER_ID;
  });

  describe('GET /api/agent (root)', () => {
    it('returns agent info with valid static token', async () => {
      const client = {
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      const { handleAgent } = await importHandlerWithClient(client);
      const req = createMockReq({
        headers: { authorization: 'Bearer test-agent-token-12345' },
      });
      const res = createMockRes();
      await handleAgent(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.scopes).toContain('notes:read');
    });

    it('returns 401 without auth token', async () => {
      const client = {
        auth: { getUser: vi.fn() },
        from: vi.fn(),
      };
      const { handleAgent } = await importHandlerWithClient(client);
      const req = createMockReq();
      const res = createMockRes();
      await handleAgent(req, res);
      expect(res.statusCode).toBe(401);
    });
  });

  describe('a token with no owner', () => {
    it('cannot list every note in the database', async () => {
      const client = {
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        update: vi.fn().mockReturnThis(),
      };
      vi.resetModules();
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_SERVICE_KEY = 'service-key';
      process.env.AGENT_API_TOKEN = 'test-agent-token-12345';
      delete process.env.AGENT_OWNER_USER_ID;
      vi.doMock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => client) }));
      const { handleAgent } = await import('../../api/_lib/agent-handler.js');
      const req = createMockReq({
        method: 'GET',
        url: '/api/agent/notes',
        headers: { authorization: 'Bearer test-agent-token-12345' },
      });
      const res = createMockRes();

      await handleAgent(req, res);

      expect(res.statusCode).toBe(403);
      expect(client.from).not.toHaveBeenCalledWith('notes');
    });
  });

  describe('GET /api/agent/stats', () => {
    it('returns totals without users array', async () => {
      const listUsersMock = vi.fn().mockResolvedValue({
        data: { users: [{ id: 'u1', email: 'a@b.com', last_sign_in_at: null }] },
        error: null,
      });
      const client = {
        auth: {
          admin: { listUsers: listUsersMock },
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'owner-user-id', email: 'owner@test.com' } },
            error: null,
          }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            // collectStats calls: .from('notes').select('*').range(from, from + pageSize - 1)
            range: vi.fn().mockResolvedValue({ data: [{ user_id: 'u1' }], error: null }),
          }),
        }),
      };
      const { handleAgent } = await importHandlerWithClient(client);
      const req = createMockReq({
        url: '/api/agent/stats',
        // Use a Supabase JWT (not the static env token) to get user-type actor
        headers: { authorization: 'Bearer some-supabase-jwt-token' },
      });
      const res = createMockRes();
      await handleAgent(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.totals).toBeDefined();
      expect(res.body.data.totals.users).toBe(1);
      expect(res.body.data.totals.notes).toBeDefined();
      // Must NOT include users array (the data leak we fixed)
      expect(res.body.data.users).toBeUndefined();
    });

    it('returns 403 for agent-type actor', async () => {
      const client = {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
        },
        from: vi.fn(),
      };
      const { handleAgent } = await importHandlerWithClient(client);
      // Static env token creates agent-type actor; stats requires user-type
      const req = createMockReq({
        url: '/api/agent/stats',
        headers: { authorization: 'Bearer test-agent-token-12345' },
      });
      const res = createMockRes();
      await handleAgent(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toContain('Only authenticated users');
    });
  });

  describe('GET /api/agent/notes', () => {
    it('returns 401 without auth token', async () => {
      const client = {
        auth: { getUser: vi.fn() },
        from: vi.fn(),
      };
      const { handleAgent } = await importHandlerWithClient(client);
      const req = createMockReq({ url: '/api/agent/notes' });
      const res = createMockRes();
      await handleAgent(req, res);
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/agent/notes — the list is metadata only', () => {
    it('sends no bodies, and says how big each one is', async () => {
      const rows = [
        {
          id: 'n1',
          note_id: 'note-1',
          title: 'Deploy checks',
          content: 'a'.repeat(1200),
          tags: [],
          folder: 'private',
          agent_access: true,
          deleted_at: null,
          version: 3,
          updated_at: '2026-11-10T10:00:00.000Z',
          created_at: '2026-11-10T09:00:00.000Z',
        },
      ];
      // The query builder is awaited directly (`await q`), so the last call has
      // to return something thenable that still answers `.eq()`/`.lte()`.
      const result = {
        eq: () => result,
        lte: () => result,
        then: (resolve) => resolve({ data: rows, error: null }),
      };
      const chain = {
        select: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn(() => result),
      };
      const client = {
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
        from: vi.fn(() => chain),
      };
      const { handleAgent } = await importHandlerWithClient(client);
      const req = createMockReq({
        url: '/api/agent/notes',
        headers: { authorization: 'Bearer test-agent-token-12345' },
      });
      const res = createMockRes();
      await handleAgent(req, res);

      expect(res.statusCode).toBe(200);
      const [note] = res.body.data;
      // "Lists are metadata only" is the promise AGENT_CONTEXT.md makes, and the
      // whole point of the product: entering the notebook must not cost a
      // context window.
      expect(note).not.toHaveProperty('content');
      expect(note.contentBytes).toBe(1200);
      expect(note.title).toBe('Deploy checks');
    });
  });

  describe('CORS', () => {
    it('sets CORS headers on responses', async () => {
      const client = {
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
        from: vi.fn(),
      };
      const { handleAgent } = await importHandlerWithClient(client);
      const req = createMockReq({ headers: { origin: 'http://localhost:5173' } });
      const res = createMockRes();
      await handleAgent(req, res);
      expect(res.headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
      expect(res.headers['Vary']).toBe('Origin');
    });

    it('handles OPTIONS preflight', async () => {
      const client = {
        auth: { getUser: vi.fn() },
        from: vi.fn(),
      };
      const { handleAgent } = await importHandlerWithClient(client);
      const req = createMockReq({ method: 'OPTIONS' });
      const res = createMockRes();
      await handleAgent(req, res);
      expect(res.statusCode).toBe(200);
    });
  });
});
