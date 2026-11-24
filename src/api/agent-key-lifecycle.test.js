import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateToken, assertScope } from '../../api/_lib/authz.js';

const USER_TOKEN = 'user-session-token';
const USER_ID = 'user-123';

/**
 * The agent API's key lifecycle, driven through the real handler and the real
 * `authz` against an in-memory fake of the two tables it touches.
 *
 * The fake applies the filters the code writes (`.eq`) and mutates rows on
 * `update`, because that is the whole question: a token stops working after a
 * revoke only if `findDelegatedConnection` filters on `is_active` AND revoke
 * writes `is_active: false`. A mock that returns a fixed row would let a revoked
 * token authenticate and prove nothing.
 */
function createFakeDb() {
  const state = { agent_connections: [], agent_connection_events: [] };
  let seq = 0;

  class FakeQuery {
    constructor(table) {
      this.table = table;
      this.mode = 'select';
      this.filters = [];
      this.payload = null;
      this.returning = false;
      this.singleRow = false;
      this.limitN = null;
      this.orderSpec = null;
      this.countMode = null;
      this.head = false;
    }

    select(_columns, options = {}) {
      if (this.mode === 'select') {
        this.projection = _columns;
      } else {
        this.returning = true;
      }
      if (options.count) this.countMode = options.count;
      if (options.head) this.head = true;
      return this;
    }

    insert(rows) {
      this.mode = 'insert';
      this.payload = Array.isArray(rows) ? rows : [rows];
      return this;
    }

    update(patch) {
      this.mode = 'update';
      this.payload = patch;
      return this;
    }

    eq(column, value) {
      this.filters.push([column, value]);
      return this;
    }

    order(column, { ascending = true } = {}) {
      this.orderSpec = [column, ascending];
      return this;
    }

    limit(n) {
      this.limitN = n;
      return this;
    }

    single() {
      this.singleRow = true;
      return this;
    }

    matched() {
      return state[this.table].filter((row) =>
        this.filters.every(([column, value]) => row[column] === value)
      );
    }

    run() {
      if (this.mode === 'insert') {
        const inserted = this.payload.map((row) => {
          seq += 1;
          return {
            id: row.id || `conn-${seq}`,
            created_at: row.created_at || new Date().toISOString(),
            updated_at: row.updated_at || new Date().toISOString(),
            ...row,
          };
        });
        state[this.table].push(...inserted);
        return { data: this.singleRow ? inserted[0] : inserted, error: null };
      }

      if (this.mode === 'update') {
        const rows = this.matched();
        rows.forEach((row) => Object.assign(row, this.payload));
        if (this.singleRow && rows.length === 0) {
          return { data: null, error: postgrestNoRows() };
        }
        return { data: this.singleRow ? rows[0] : rows, error: null };
      }

      let rows = this.matched();
      if (this.orderSpec) {
        const [column, ascending] = this.orderSpec;
        rows = [...rows].sort((a, b) =>
          ascending ? String(a[column]).localeCompare(String(b[column])) : String(b[column]).localeCompare(String(a[column]))
        );
      }
      if (this.limitN != null) rows = rows.slice(0, this.limitN);

      if (this.countMode) return { count: rows.length, data: null, error: null };
      if (this.singleRow && rows.length === 0) return { data: null, error: postgrestNoRows() };
      return { data: this.singleRow ? rows[0] : rows, error: null };
    }

    then(resolve, reject) {
      return Promise.resolve()
        .then(() => this.run())
        .then(resolve, reject);
    }
  }

  function postgrestNoRows() {
    return {
      code: 'PGRST116',
      message: 'JSON object requested, multiple (or no) rows returned',
    };
  }

  return {
    state,
    rows: (table) => state[table],
    from: (table) => {
      if (!(table in state)) throw new Error(`unexpected table ${table}`);
      return new FakeQuery(table);
    },
    auth: {
      getUser: vi.fn(async (token) =>
        token === USER_TOKEN
          ? { data: { user: { id: USER_ID, email: 'ves@example.com' } }, error: null }
          : { data: { user: null }, error: { message: 'invalid token' } }
      ),
    },
  };
}

function createMockReq({ method = 'GET', url = '/api/agent', query = {}, headers = {}, body = null } = {}) {
  return { method, url, query, headers, body };
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

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

let db;
let handleAgent;

async function boot() {
  vi.resetModules();
  delete process.env.AGENT_API_TOKEN;
  delete process.env.AGENT_API_TOKENS;
  delete process.env.AGENT_OWNER_USER_ID;
  delete process.env.AGENT_TOKEN_SCOPES_JSON;
  delete process.env.AGENT_TOKEN_EXPIRATIONS_JSON;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service-key';
  db = createFakeDb();
  vi.doMock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => db) }));
  ({ handleAgent } = await import('../../api/_lib/agent-handler.js'));
}

/** Issue a delegated connection through the API, as a signed-in user does. */
async function issueConnection(body = {}) {
  const res = createMockRes();
  await handleAgent(
    createMockReq({
      method: 'POST',
      url: '/api/agent/connections',
      headers: { authorization: `Bearer ${USER_TOKEN}` },
      body: { scopes: ['notes:read', 'notes:write'], ...body },
    }),
    res
  );
  return res;
}

/** Call the agent API with an agent token, the way an agent does. */
async function callAgent(token, { method = 'GET', url = '/api/agent', query = {} } = {}) {
  const res = createMockRes();
  await handleAgent(
    createMockReq({ method, url, query, headers: { authorization: `Bearer ${token}` } }),
    res
  );
  return res;
}

beforeEach(async () => {
  await boot();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('agent key lifecycle — create', () => {
  it('shows the token once and stores only its hash', async () => {
    const res = await issueConnection({ scopes: ['notes:read', 'notes:write'] });

    expect(res.statusCode).toBe(201);
    const token = res.body.data.token;
    expect(typeof token).toBe('string');
    expect(token.startsWith('agent_')).toBe(true);

    const [row] = db.rows('agent_connections');
    expect(row.token_hash).toBe(sha256(token));
    expect(row.token_prefix).toBe(token.slice(0, 12));
    expect(row.is_active).toBe(true);
    expect(row.user_id).toBe(USER_ID);

    // The raw token exists in the one response that issued it and nowhere else:
    // not in the stored row, not in the serialised connection it returned.
    expect(JSON.stringify(row)).not.toContain(token);
    expect(res.body.data.token_hash).toBeUndefined();
    expect(res.body.data.tokenPrefix).toBe(token.slice(0, 12));
    expect(row.token).toBeUndefined();
  });

  it('never returns the hash, and never the token, when listing connections', async () => {
    const issued = await issueConnection();
    const token = issued.body.data.token;

    const res = createMockRes();
    await handleAgent(
      createMockReq({
        method: 'GET',
        url: '/api/agent/connections',
        headers: { authorization: `Bearer ${USER_TOKEN}` },
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain(token);
    expect(res.body.data[0].token_hash).toBeUndefined();
  });

  it('answers a request that cannot be satisfied as a client error, not a server error', async () => {
    const noScopes = await issueConnection({ scopes: ['notes:telepathy'] });
    expect(noScopes.statusCode).toBe(400);
    expect(noScopes.body.error).toContain('scope');

    const pastExpiry = await issueConnection({ expiresAt: '2000-01-01T00:00:00.000Z' });
    expect(pastExpiry.statusCode).toBe(400);
    expect(pastExpiry.body.error).toContain('future');

    const tooLong = await issueConnection({
      expiresAt: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.body.error).toContain('maximum allowed lifetime');

    expect(db.rows('agent_connections')).toHaveLength(0);
  });

  it('stops issuing once the active-connection limit is reached', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await issueConnection();
      expect(res.statusCode).toBe(201);
    }

    const res = await issueConnection();
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toContain('limit reached');
    expect(db.rows('agent_connections')).toHaveLength(5);
  });
});

describe('agent key lifecycle — use and scope', () => {
  it('authenticates with the issued token and carries the scopes it was issued with', async () => {
    const issued = await issueConnection({ scopes: ['notes:read'], agentLabel: 'Claude Code' });
    const token = issued.body.data.token;

    const { actor, error } = await authenticateToken({ token, supabase: db });
    expect(error).toBeNull();
    expect(actor).toMatchObject({ type: 'agent', userId: USER_ID, connectionId: 'conn-1' });
    expect(actor.scopes).toEqual(['notes:read']);

    const res = await callAgent(token);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.scopes).toEqual(['notes:read']);
    expect(res.body.data.agent).toBe('Claude Code');
  });

  it('refuses a write to a key issued read-only', async () => {
    const issued = await issueConnection({ scopes: ['notes:read'] });
    const token = issued.body.data.token;

    const { actor } = await authenticateToken({ token, supabase: db });
    const scopeCheck = assertScope(actor, 'notes:write');
    expect(scopeCheck.ok).toBe(false);
    expect(scopeCheck.status).toBe(403);

    const res = await callAgent(token, { method: 'PATCH', url: '/api/agent/notes/note-1' });
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain('notes:write');
  });

  it('records that the key was used', async () => {
    const issued = await issueConnection();
    const token = issued.body.data.token;

    await callAgent(token);
    expect(db.rows('agent_connections')[0].last_used_at).toBeTruthy();
  });
});

describe('agent key lifecycle — expire', () => {
  it('refuses a key whose expiry has passed', async () => {
    const issued = await issueConnection({
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    const token = issued.body.data.token;
    expect((await callAgent(token)).statusCode).toBe(200);

    // The clock moves past the expiry the key was issued with.
    db.rows('agent_connections')[0].expires_at = new Date(Date.now() - 1000).toISOString();

    const res = await callAgent(token);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toContain('expired');
  });
});

describe('agent key lifecycle — revoke', () => {
  it('invalidates the key on the next request', async () => {
    const issued = await issueConnection();
    const token = issued.body.data.token;
    const connectionId = issued.body.data.id;

    expect((await callAgent(token)).statusCode).toBe(200);

    const revokeRes = createMockRes();
    await handleAgent(
      createMockReq({
        method: 'DELETE',
        url: `/api/agent/connections/${connectionId}`,
        headers: { authorization: `Bearer ${USER_TOKEN}` },
      }),
      revokeRes
    );
    expect(revokeRes.statusCode).toBe(200);
    expect(revokeRes.body.data.isActive).toBe(false);
    expect(db.rows('agent_connections')[0].is_active).toBe(false);

    // No waiting, no cache: the very next request with that token is refused.
    const after = await callAgent(token);
    expect(after.statusCode).toBe(401);

    const events = db.rows('agent_connection_events').map((event) => event.action);
    expect(events).toContain('issued');
    expect(events).toContain('revoked');
  });

  it('revokes every key a user holds in one call', async () => {
    const first = (await issueConnection()).body.data.token;
    const second = (await issueConnection()).body.data.token;

    const res = createMockRes();
    await handleAgent(
      createMockReq({
        method: 'DELETE',
        url: '/api/agent/connections',
        headers: { authorization: `Bearer ${USER_TOKEN}` },
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect((await callAgent(first)).statusCode).toBe(401);
    expect((await callAgent(second)).statusCode).toBe(401);
  });

  it('answers 404 for a connection that is not there instead of 500', async () => {
    const res = createMockRes();
    await handleAgent(
      createMockReq({
        method: 'DELETE',
        url: '/api/agent/connections/conn-does-not-exist',
        headers: { authorization: `Bearer ${USER_TOKEN}` },
      }),
      res
    );

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toContain('not found');
  });
});

describe('agent key material stays out of logs, URLs and error payloads', () => {
  it('never logs, echoes or accepts a token outside the header it travels in', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const issued = await issueConnection();
    const token = issued.body.data.token;

    const responses = [issued];
    responses.push(await callAgent(token));
    responses.push(await callAgent(token, { method: 'PATCH', url: '/api/agent/notes/note-1' }));
    responses.push(await callAgent('agent_not-a-real-token'));

    // A credential in a URL is a credential published: the query form is ignored
    // and the request is answered as unauthenticated.
    responses.push(await callAgent('', { query: { token } }));
    const queryTokenRes = createMockRes();
    await handleAgent(
      createMockReq({ url: `/api/agent/notes?token=${token}`, query: { token } }),
      queryTokenRes
    );
    responses.push(queryTokenRes);
    expect(queryTokenRes.statusCode).toBe(401);

    // Revoking answers with the connection, not with the credential.
    const revokeRes = createMockRes();
    await handleAgent(
      createMockReq({
        method: 'DELETE',
        url: `/api/agent/connections/${issued.body.data.id}`,
        headers: { authorization: `Bearer ${USER_TOKEN}` },
      }),
      revokeRes
    );
    responses.push(revokeRes);

    // The one response allowed to carry it is the one that issued it.
    responses.slice(1).forEach((res) => {
      expect(JSON.stringify(res.body)).not.toContain(token);
    });

    const logged = [...log.mock.calls, ...warn.mock.calls, ...error.mock.calls]
      .flat()
      .map((value) => (typeof value === 'string' ? value : JSON.stringify(value) || ''))
      .join('\n');
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(sha256(token));
  });
});
