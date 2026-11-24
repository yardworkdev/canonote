import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AGENT_API.md is the document an agent's author follows, so its examples are
 * executed here against the real handler: a copy-paste block that no longer
 * works is a broken promise, and prose that drifts from the code is a bug in
 * this repo (see DECISIONS.md — "docs must match code").
 *
 * The payloads are read out of the document rather than retyped, so editing an
 * example edits what the test drives. The statuses the document promises are
 * asserted from the handler's own answers.
 */

const USER_TOKEN = 'user-session-token';
const USER_ID = 'user-123';
const STATIC_TOKEN = 'static-agent-token';

const doc = () => readFileSync(join(process.cwd(), 'AGENT_API.md'), 'utf8');

/** Every JSON payload a `-d '…'` example in the document sends. */
function documentedPayloads() {
  const source = doc();
  const payloads = [];
  const pattern = /-d '([^']+)'/g;
  let match = pattern.exec(source);
  while (match) {
    try {
      payloads.push(JSON.parse(match[1]));
    } catch {
      // A payload built with shell variables (the PATCH loop) is not JSON here;
      // its statuses are asserted directly instead.
    }
    match = pattern.exec(source);
  }
  return payloads;
}

const payloadFor = (key) => {
  const found = documentedPayloads().find((payload) => key in payload);
  if (!found) throw new Error(`AGENT_API.md documents no example payload with "${key}"`);
  return found;
};

/**
 * An in-memory stand-in for the tables the handler touches. It applies the
 * filters the code writes, because that is the question the examples ask: a
 * `notes` row's `version` increments on update the way the trigger in migration
 * 010 increments it, so a documented `ifRevision` really is checked against
 * something.
 */
function createFakeDb() {
  const state = {
    agent_connections: [],
    agent_connection_events: [],
    agent_audit_log: [],
    notes: [],
  };
  let seq = 0;

  const postgrestNoRows = () => ({
    code: 'PGRST116',
    message: 'JSON object requested, multiple (or no) rows returned',
  });

  class FakeQuery {
    constructor(table) {
      this.table = table;
      this.mode = 'select';
      this.filters = [];
      this.isFilters = [];
      this.payload = null;
      this.orderSpecs = [];
      this.limitN = null;
      this.singleRow = false;
      this.maybeSingleRow = false;
      this.countMode = false;
    }

    select(_columns, options = {}) {
      if (this.mode !== 'select') this.returning = true;
      if (options.count) this.countMode = true;
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

    is(column, value) {
      this.isFilters.push([column, value]);
      return this;
    }

    order(column, { ascending = true } = {}) {
      this.orderSpecs.push([column, ascending]);
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

    maybeSingle() {
      this.maybeSingleRow = true;
      return this;
    }

    matched() {
      return state[this.table].filter(
        (row) =>
          this.filters.every(([column, value]) => row[column] === value) &&
          this.isFilters.every(([column, value]) => (row[column] ?? null) === value)
      );
    }

    sorted(rows) {
      if (this.orderSpecs.length === 0) return rows;
      return [...rows].sort((a, b) => {
        for (const [column, ascending] of this.orderSpecs) {
          const left = String(a[column] ?? '');
          const right = String(b[column] ?? '');
          if (left === right) continue;
          return ascending ? left.localeCompare(right) : right.localeCompare(left);
        }
        return 0;
      });
    }

    run() {
      if (this.mode === 'insert') {
        const inserted = this.payload.map((row) => {
          seq += 1;
          const withDefaults = {
            id: row.id || `row-${seq}`,
            created_at: row.created_at || new Date().toISOString(),
            updated_at: row.updated_at || new Date().toISOString(),
            ...row,
          };
          // The `notes` table's version column defaults to 1 and the trigger
          // bumps it on every update (supabase/migrations/010).
          if (this.table === 'notes') withDefaults.version = withDefaults.version ?? 1;
          return withDefaults;
        });
        state[this.table].push(...inserted);
        return { data: this.singleRow ? inserted[0] : inserted, error: null };
      }

      if (this.mode === 'update') {
        const rows = this.matched();
        rows.forEach((row) => {
          Object.assign(row, this.payload);
          if (this.table === 'notes') row.version = (row.version ?? 0) + 1;
        });
        if ((this.singleRow || this.maybeSingleRow) && rows.length === 0) {
          return { data: null, error: this.maybeSingleRow ? null : postgrestNoRows() };
        }
        return { data: this.singleRow || this.maybeSingleRow ? rows[0] : rows, error: null };
      }

      let rows = this.sorted(this.matched());
      if (this.limitN != null) rows = rows.slice(0, this.limitN);
      if (this.countMode) return { count: rows.length, data: null, error: null };
      if ((this.singleRow || this.maybeSingleRow) && rows.length === 0) {
        return { data: null, error: this.maybeSingleRow ? null : postgrestNoRows() };
      }
      return { data: this.singleRow || this.maybeSingleRow ? rows[0] : rows, error: null };
    }

    then(resolve, reject) {
      return Promise.resolve()
        .then(() => this.run())
        .then(resolve, reject);
    }
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

const asUser = (token = USER_TOKEN) => ({ authorization: `Bearer ${token}` });

async function call({ token, ...rest } = {}) {
  const res = createMockRes();
  await handleAgent(
    createMockReq({ ...rest, headers: token ? { ...asUser(token), ...(rest.headers || {}) } : rest.headers || {} }),
    res
  );
  return res;
}

let db;
let handleAgent;

async function boot({ withStaticToken = true } = {}) {
  vi.resetModules();
  delete process.env.AGENT_API_TOKENS;
  delete process.env.AGENT_OWNER_USER_ID;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service-key';
  if (withStaticToken) {
    process.env.AGENT_API_TOKEN = STATIC_TOKEN;
    process.env.AGENT_OWNER_USER_ID = USER_ID;
  } else {
    delete process.env.AGENT_API_TOKEN;
  }
  db = createFakeDb();
  vi.doMock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => db) }));
  ({ handleAgent } = await import('../../api/_lib/agent-handler.js'));
}

/** Issue a key the way the document's first example does. */
async function issueKey(overrides = {}) {
  return call({
    token: USER_TOKEN,
    method: 'POST',
    url: '/api/agent/connections',
    body: { ...payloadFor('agentLabel'), ...overrides },
  });
}

beforeEach(async () => {
  await boot();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AGENT_API_TOKEN;
  delete process.env.AGENT_OWNER_USER_ID;
});

describe('AGENT_API.md — the route list', () => {
  it('documents every route the API advertises, and no route it does not', async () => {
    const res = await call({ token: STATIC_TOKEN });
    expect(res.statusCode).toBe(200);

    const advertised = new Set(res.body.data.routes);
    const source = doc();
    const documented = new Set();
    for (const pattern of [/`(GET|POST|PATCH|DELETE) (\/api\/agent[^`]*)`/g, /"(GET|POST|PATCH|DELETE) (\/api\/agent[^"]*)"/g]) {
      let match = pattern.exec(source);
      while (match) {
        documented.add(`${match[1]} ${match[2]}`);
        match = pattern.exec(source);
      }
    }

    const undocumented = [...advertised].filter((route) => !documented.has(route));
    const invented = [...documented].filter((route) => !advertised.has(route));
    expect(undocumented).toEqual([]);
    expect(invented).toEqual([]);
  });
});

describe('AGENT_API.md — the examples the document shows', () => {
  it('answers a request with no token 401, as the error table says', async () => {
    const res = await call({ url: '/api/agent' });
    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('ignores a token in the query string, as the document says it does', async () => {
    const res = await call({ url: `/api/agent?token=${STATIC_TOKEN}`, query: { token: STATIC_TOKEN } });
    expect(res.statusCode).toBe(401);
  });

  it('accepts the documented key-issuing example and returns the token once', async () => {
    const res = await issueKey();

    expect(res.statusCode).toBe(201);
    const token = res.body.data.token;
    expect(token.startsWith('agent_')).toBe(true);
    expect(res.body.data.tokenPrefix).toBe(token.slice(0, 12));

    const [row] = db.rows('agent_connections');
    expect(JSON.stringify(row)).not.toContain(token);
    expect(res.body.data.token_hash).toBeUndefined();
  });

  it('answers a key issued with a scope outside the four 400', async () => {
    const res = await issueKey({ scopes: ['notes:admin'] });
    expect(res.statusCode).toBe(400);
  });

  it('answers an expiry in the past 400, and one beyond the maximum lifetime 400', async () => {
    const past = await issueKey({ expiresAt: '2020-01-01T00:00:00.000Z' });
    expect(past.statusCode).toBe(400);

    const tooLong = await issueKey({
      expiresAt: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(tooLong.statusCode).toBe(400);
  });

  it('answers the sixth active key 429, the documented limit', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await issueKey({ agentLabel: `Agent ${i}` });
      expect(res.statusCode).toBe(201);
    }
    const sixth = await issueKey({ agentLabel: 'Agent 6' });
    expect(sixth.statusCode).toBe(429);
  });

  it('answers an agent token on a human-only route 403, as the route table says', async () => {
    const issued = await issueKey();
    const token = issued.body.data.token;

    for (const request of [
      { method: 'GET', url: '/api/agent/connections' },
      { method: 'POST', url: '/api/agent/connections', body: payloadFor('agentLabel') },
      { method: 'DELETE', url: '/api/agent/connections/row-1' },
      { method: 'DELETE', url: '/api/agent/connections' },
    ]) {
      const res = await call({ token, ...request });
      expect(res.statusCode, `${request.method} ${request.url}`).toBe(403);
    }
  });

  it('answers a missing scope 403, naming the scope', async () => {
    const writeOnly = (await issueKey({ scopes: ['notes:write'] })).body.data.token;
    const read = await call({ token: writeOnly, url: '/api/agent/notes' });
    expect(read.statusCode).toBe(403);
    expect(read.body.error).toContain('notes:read');

    const readOnly = (await issueKey({ scopes: ['notes:read'] })).body.data.token;
    const write = await call({ token: readOnly, method: 'POST', url: '/api/agent/notes', body: { title: 'x' } });
    expect(write.statusCode).toBe(403);
    expect(write.body.error).toContain('notes:write');
  });

  it('answers stats for an agent token 403, as the route table says', async () => {
    const issued = await issueKey();
    const res = await call({ token: issued.body.data.token, url: '/api/agent/stats' });
    expect(res.statusCode).toBe(403);
  });

  it('creates the documented note in the agent folder with an ETag', async () => {
    const issued = await issueKey();
    const token = issued.body.data.token;

    const res = await call({
      token,
      method: 'POST',
      url: '/api/agent/notes',
      body: payloadFor('title'),
    });

    expect(res.statusCode).toBe(201);
    const note = res.body.data;
    expect(note.title).toBe(payloadFor('title').title);
    expect(note.content).toBe(payloadFor('title').content);
    expect(note.folder).toBe('agent');
    expect(note.revision).toBe('1');
    expect(res.headers.ETag).toBe(`"${note.revision}"`);
    expect(db.rows('notes')[0].created_by).toBe('agent');
    expect(db.rows('agent_audit_log').map((row) => row.action)).toEqual(['notes.create']);
  });

  it('records the owner on the audit row, so the trail can be read back', async () => {
    const issued = await issueKey();
    const token = issued.body.data.token;
    const created = await call({
      token,
      method: 'POST',
      url: '/api/agent/notes',
      body: payloadFor('title'),
    });

    // The owner is what makes the trail readable (migration 014): without it
    // the read can only answer "every event from every user".
    const [written] = db.rows('agent_audit_log');
    expect(written.user_id).toBe(USER_ID);
    expect(written.metadata.title).toBe(payloadFor('title').title);

    const trail = await call({ token: USER_TOKEN, url: '/api/agent/audit' });
    expect(trail.statusCode).toBe(200);
    expect(trail.body.data.map((event) => event.action)).toEqual(['notes.create']);
    expect(trail.body.data[0].noteId).toBe(created.body.data.note_id);
  });

  it('returns the documented list fields and pageInfo', async () => {
    const issued = await issueKey();
    const token = issued.body.data.token;
    await call({ token, method: 'POST', url: '/api/agent/notes', body: payloadFor('title') });

    const res = await call({ token, url: '/api/agent/notes?limit=50', query: { limit: '50' } });

    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.body.pageInfo).sort()).toEqual(['hasMore', 'limit', 'nextCursor', 'since']);
    expect(typeof res.body.pageInfo.since).toBe('string');
    expect(Number.isNaN(Date.parse(res.body.pageInfo.since))).toBe(false);
    expect(res.body.pageInfo.limit).toBe(50);
    expect(res.body.pageInfo.hasMore).toBe(false);

    const [item] = res.body.data;
    // A list is metadata only: the body is fetched per note, and `contentBytes`
    // is how an agent decides which note deserves that call.
    expect(item).not.toHaveProperty('content');
    expect(typeof item.contentBytes).toBe('number');
    // The row is what an agent pays for on entry, so it carries only the fields a
    // next call needs: which note, how big, how recent, who wrote it, which version.
    for (const field of ['id', 'title', 'revision', 'updated_at', 'created_at', 'tags', 'contentBytes', 'written_by']) {
      expect(item, field).toHaveProperty(field);
    }
    expect(item.id).toMatch(/^note-/);
    expect(Object.keys(item).sort()).toEqual(
      ['contentBytes', 'created_at', 'id', 'revision', 'tags', 'title', 'updated_at', 'written_by'].sort()
    );
  });

  it('reads one note with an ETag, and answers an unknown id 404', async () => {
    const issued = await issueKey();
    const token = issued.body.data.token;
    const created = await call({ token, method: 'POST', url: '/api/agent/notes', body: payloadFor('title') });
    const noteId = created.body.data.note_id;

    const found = await call({ token, url: `/api/agent/notes/${noteId}` });
    expect(found.statusCode).toBe(200);
    expect(found.headers.ETag).toBe(`"${found.body.data.revision}"`);

    const missing = await call({ token, url: '/api/agent/notes/note-does-not-exist' });
    expect(missing.statusCode).toBe(404);
  });

  it('walks the documented read-modify-write loop: 428, then 409, then 200', async () => {
    const issued = await issueKey();
    const token = issued.body.data.token;
    const created = await call({ token, method: 'POST', url: '/api/agent/notes', body: payloadFor('title') });
    const noteId = created.body.data.note_id;

    // The example's step 1: read the note, keep the revision.
    const read = await call({ token, url: `/api/agent/notes/${noteId}` });
    const revision = read.body.data.revision;

    // Step 2 without a revision: the document promises 428.
    const noRevision = await call({
      token,
      method: 'PATCH',
      url: `/api/agent/notes/${noteId}`,
      body: { content: 'rewritten\n' },
    });
    expect(noRevision.statusCode).toBe(428);

    // A revision that is no longer current: 409, carrying the current note.
    const stale = await call({
      token,
      method: 'PATCH',
      url: `/api/agent/notes/${noteId}`,
      body: { content: 'rewritten\n', ifRevision: '999' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.body.currentRevision).toBe(revision);
    expect(stale.body.data.note_id).toBe(noteId);

    // The revision read in step 1: 200, and the revision moves on.
    const written = await call({
      token,
      method: 'PATCH',
      url: `/api/agent/notes/${noteId}`,
      body: { content: 'rewritten\n', ifRevision: revision },
    });
    expect(written.statusCode).toBe(200);
    expect(written.body.data.content).toBe('rewritten\n');
    expect(written.body.data.revision).not.toBe(revision);
    expect(written.headers.ETag).toBe(`"${written.body.data.revision}"`);
  });

  it('accepts the documented If-Match header instead of a body revision', async () => {
    const issued = await issueKey();
    const token = issued.body.data.token;
    const created = await call({ token, method: 'POST', url: '/api/agent/notes', body: payloadFor('title') });
    const noteId = created.body.data.note_id;
    const revision = created.body.data.revision;

    const res = await call({
      token,
      method: 'PATCH',
      url: `/api/agent/notes/${noteId}`,
      headers: { 'if-match': `"${revision}"` },
      body: { content: 'by header\n' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.content).toBe('by header\n');
  });

  it('answers a body userId that is not the authenticated user 403, as the document says', async () => {
    const issued = await issueKey();
    const token = issued.body.data.token;

    const res = await call({
      token,
      method: 'POST',
      url: '/api/agent/notes',
      body: { title: 'Mine', userId: 'somebody-else' },
    });

    expect(res.statusCode).toBe(403);
  });
});
