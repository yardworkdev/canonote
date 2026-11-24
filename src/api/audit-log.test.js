import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `GET /api/agent/audit` — the read half of slice 4's audit item.
 *
 * The events were written and nothing could read them: `agent_audit_log` had no
 * owner column, so the only read it could support was "every event from every
 * user". These specs drive the real handler and the real module against a fake
 * of the table that honours the filters the code writes, so a read scoped to
 * the wrong column fails here rather than in production.
 *
 * Three answers matter and they are not the same answer: the trail of the notes
 * this token owns, "this token owns nothing" (403), and "the store refused"
 * (500). Collapsing the last two is how a reader is told their notebook has no
 * history when the truth is that nobody could look.
 */

const USER_TOKEN = 'user-session-token';
const USER_ID = 'user-123';
const OTHER_USER_ID = 'user-999';
const STATIC_TOKEN = 'static-agent-token';

const row = (overrides = {}) => ({
  event_id: overrides.event_id || `evt-${Math.random().toString(16).slice(2)}`,
  user_id: USER_ID,
  note_key: 'note-1730000000000-ab12cd',
  actor_id: 'agent_rudi',
  actor_type: 'agent',
  action: 'notes.update',
  before_hash: 'before',
  after_hash: 'after',
  metadata: { title: 'Morning pages' },
  created_at: '2026-10-16T09:00:00.000Z',
  ...overrides,
});

/** The tables the handler touches, with the filters and ordering it writes. */
function createFakeDb({ auditRows = [], failTables = [] } = {}) {
  const state = { agent_audit_log: auditRows, agent_connections: [], notes: [] };

  class FakeQuery {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.orderSpec = null;
      this.limitN = null;
    }

    select() {
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

    run() {
      if (failTables.includes(this.table)) {
        return { data: null, error: { message: 'relation does not exist' } };
      }
      let rows = state[this.table].filter((candidate) =>
        this.filters.every(([column, value]) => candidate[column] === value)
      );
      if (this.orderSpec) {
        const [column, ascending] = this.orderSpec;
        rows = [...rows].sort((a, b) => {
          const left = String(a[column] ?? '');
          const right = String(b[column] ?? '');
          if (left === right) return 0;
          return ascending ? left.localeCompare(right) : right.localeCompare(left);
        });
      }
      if (this.limitN != null) rows = rows.slice(0, this.limitN);
      return { data: rows, error: null };
    }

    then(resolve, reject) {
      return Promise.resolve()
        .then(() => this.run())
        .then(resolve, reject);
    }
  }

  return {
    state,
    from(table) {
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

let db;
let handleAgent;

async function boot({ auditRows = [], failTables = [], ownerId = USER_ID } = {}) {
  vi.resetModules();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service-key';
  process.env.AGENT_API_TOKEN = STATIC_TOKEN;
  if (ownerId) process.env.AGENT_OWNER_USER_ID = ownerId;
  else delete process.env.AGENT_OWNER_USER_ID;

  db = createFakeDb({ auditRows, failTables });
  vi.doMock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => db) }));
  ({ handleAgent } = await import('../../api/_lib/agent-handler.js'));
}

async function callAudit({ token = USER_TOKEN, limit, query = {}, headers = {} } = {}) {
  const res = createMockRes();
  await handleAgent(
    {
      method: 'GET',
      url: '/api/agent/audit',
      query: { ...(limit === undefined ? {} : { limit }), ...query },
      headers: { authorization: `Bearer ${token}`, ...headers },
      body: null,
    },
    res
  );
  return res;
}

beforeEach(async () => {
  await boot();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AGENT_API_TOKEN;
  delete process.env.AGENT_OWNER_USER_ID;
});

describe('GET /api/agent/audit', () => {
  it('answers the trail of the notes this token owns, newest first', async () => {
    await boot({
      auditRows: [
        row({ event_id: 'old', created_at: '2026-10-15T08:00:00.000Z' }),
        row({ event_id: 'new', created_at: '2026-10-16T12:00:00.000Z' }),
      ],
    });

    const res = await callAudit();
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.map((event) => event.eventId)).toEqual(['new', 'old']);
    expect(res.body.data[0]).toMatchObject({
      noteId: 'note-1730000000000-ab12cd',
      actorId: 'agent_rudi',
      actorType: 'agent',
      action: 'notes.update',
      beforeHash: 'before',
      afterHash: 'after',
      metadata: { title: 'Morning pages' },
    });
  });

  it('never returns another user’s events', async () => {
    await boot({
      auditRows: [
        row({ event_id: 'mine', user_id: USER_ID }),
        row({ event_id: 'theirs', user_id: OTHER_USER_ID }),
      ],
    });

    const res = await callAudit();
    expect(res.statusCode).toBe(200);
    expect(res.body.data.map((event) => event.eventId)).toEqual(['mine']);
  });

  it('caps the read and says whether there is more', async () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      row({ event_id: `evt-${index}`, created_at: `2026-10-1${index}T08:00:00.000Z` })
    );
    await boot({ auditRows: rows });

    const capped = await callAudit({ limit: 3 });
    expect(capped.body.data).toHaveLength(3);
    expect(capped.body.pageInfo).toMatchObject({ limit: 3, returned: 3, hasMore: true });

    await boot({ auditRows: rows.slice(0, 2) });
    const short = await callAudit({ limit: 3 });
    expect(short.body.data).toHaveLength(2);
    expect(short.body.pageInfo).toMatchObject({ returned: 2, hasMore: false });
  });

  it('answers an empty list for a notebook nothing has touched', async () => {
    const res = await callAudit();
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pageInfo.hasMore).toBe(false);
  });

  it('refuses a token that is not attached to a user, and does not call it empty', async () => {
    await boot({ auditRows: [row()], ownerId: null });

    const res = await callAudit({ token: STATIC_TOKEN });
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/not attached to a user/i);
  });

  it('needs a token at all', async () => {
    const res = createMockRes();
    await handleAgent(
      { method: 'GET', url: '/api/agent/audit', query: {}, headers: {}, body: null },
      res
    );
    expect(res.statusCode).toBe(401);
  });

  it('says the read failed rather than that the trail is empty', async () => {
    await boot({ auditRows: [row()], failTables: ['agent_audit_log'] });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await callAudit();
    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
    expect(quiet).toHaveBeenCalled();
  });

  it('advertises itself on GET /api/agent', async () => {
    const res = createMockRes();
    await handleAgent(
      {
        method: 'GET',
        url: '/api/agent',
        query: {},
        headers: { authorization: `Bearer ${STATIC_TOKEN}` },
        body: null,
      },
      res
    );
    expect(res.body.data.routes).toContain('GET /api/agent/audit');
  });
});

describe('the audit read module', () => {
  it('reads a limit from the query string, clamped and defaulted', async () => {
    const { AUDIT_DEFAULT_LIMIT, AUDIT_MAX_LIMIT, parseAuditLimit } = await import(
      '../../api/_lib/audit-log.js'
    );
    expect(parseAuditLimit(undefined)).toBe(AUDIT_DEFAULT_LIMIT);
    expect(parseAuditLimit('')).toBe(AUDIT_DEFAULT_LIMIT);
    expect(parseAuditLimit('nonsense')).toBe(AUDIT_DEFAULT_LIMIT);
    expect(parseAuditLimit('0')).toBe(AUDIT_DEFAULT_LIMIT);
    expect(parseAuditLimit('-5')).toBe(AUDIT_DEFAULT_LIMIT);
    expect(parseAuditLimit('25')).toBe(25);
    expect(parseAuditLimit('10000')).toBe(AUDIT_MAX_LIMIT);
  });

  it('names every field the API answers with, and nothing about the schema', async () => {
    const { auditEventView } = await import('../../api/_lib/audit-log.js');
    expect(Object.keys(auditEventView({}))).toEqual([
      'eventId',
      'noteId',
      'actorId',
      'actorType',
      'action',
      'beforeHash',
      'afterHash',
      'metadata',
      'createdAt',
    ]);
    expect(auditEventView({ metadata: 'not an object' }).metadata).toEqual({});
    expect(auditEventView().eventId).toBeNull();
  });

  it('answers no-owner instead of an empty trail when there is nothing to scope to', async () => {
    const { listAuditEvents } = await import('../../api/_lib/audit-log.js');
    expect(await listAuditEvents({ supabase: null, userId: USER_ID })).toMatchObject({
      ok: false,
      reason: 'no-owner',
    });
    expect(await listAuditEvents({ supabase: {}, userId: null })).toMatchObject({
      ok: false,
      reason: 'no-owner',
    });
  });
});
