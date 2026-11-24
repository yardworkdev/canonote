import { beforeEach, describe, expect, it } from 'vitest';
import { authenticateToken, getBearerToken, hasScope, assertScope } from '../../api/_lib/authz.js';

function createMockSupabase(connectionRow) {
  return {
    from(table) {
      if (table !== 'agent_connections') {
        throw new Error(`unexpected table ${table}`);
      }

      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        limit() {
          return Promise.resolve({ data: connectionRow ? [connectionRow] : [], error: null });
        },
        update() {
          return {
            eq() {
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
    auth: {
      getUser() {
        return Promise.resolve({ data: null, error: new Error('not a user token') });
      },
    },
  };
}

describe('authenticateToken delegated connections', () => {
  beforeEach(() => {
    delete process.env.AGENT_API_TOKEN;
    delete process.env.AGENT_API_TOKENS;
    delete process.env.AGENT_OWNER_USER_ID;
    delete process.env.AGENT_TOKEN_SCOPES_JSON;
    delete process.env.AGENT_TOKEN_EXPIRATIONS_JSON;
  });

  it('authenticates a DB-backed delegated agent connection', async () => {
    const result = await authenticateToken({
      token: 'delegated-token',
      supabase: createMockSupabase({
        id: 'conn-1',
        user_id: 'user-123',
        agent_id: 'agent_rudi',
        agent_label: 'Rudi',
        scopes: ['notes:read', 'notes:write', 'collab:read', 'collab:write'],
        is_active: true,
        expires_at: null,
      }),
    });

    expect(result.error).toBeNull();
    expect(result.actor).toMatchObject({
      type: 'agent',
      id: 'agent_rudi',
      name: 'Rudi',
      userId: 'user-123',
      connectionId: 'conn-1',
    });
  });

  it('rejects an expired DB-backed delegated agent connection', async () => {
    const result = await authenticateToken({
      token: 'delegated-token',
      supabase: createMockSupabase({
        id: 'conn-2',
        user_id: 'user-123',
        agent_id: 'agent_rudi',
        agent_label: 'Rudi',
        scopes: ['notes:read'],
        is_active: true,
        expires_at: '2000-01-01T00:00:00.000Z',
      }),
    });

    expect(result.actor).toBeNull();
    expect(result.error).toBe('expired');
  });
});

describe('getBearerToken', () => {
  it('extracts from Authorization header', () => {
    expect(getBearerToken({ headers: { authorization: 'Bearer my-token' } })).toBe('my-token');
  });

  it('extracts from x-agent-token header', () => {
    expect(getBearerToken({ headers: { 'x-agent-token': 'agent-token' } })).toBe('agent-token');
  });

  it('ignores a token in the query string', () => {
    // A URL is logged, shared and cached; a credential in one is published.
    expect(getBearerToken({ headers: {}, query: { token: 'query-token' } })).toBeNull();
    expect(getBearerToken({ headers: {}, query: { token: ['query-token'] } })).toBeNull();
    // A header still wins over anything in the query.
    expect(
      getBearerToken({
        headers: { authorization: 'Bearer header-token' },
        query: { token: 'query-token' },
      })
    ).toBe('header-token');
  });

  it('returns null when no token present', () => {
    expect(getBearerToken({ headers: {}, query: {} })).toBeNull();
  });

  it('trims whitespace from token', () => {
    expect(getBearerToken({ headers: { authorization: 'Bearer  spaces  ' } })).toBe('spaces');
  });

  it('prefers Authorization header over x-agent-token', () => {
    expect(getBearerToken({
      headers: { authorization: 'Bearer first', 'x-agent-token': 'second' },
    })).toBe('first');
  });
});

describe('hasScope', () => {
  it('returns true for included scope', () => {
    expect(hasScope({ scopes: ['notes:read', 'notes:write'] }, 'notes:read')).toBe(true);
  });

  it('returns false for missing scope', () => {
    expect(hasScope({ scopes: ['notes:read'] }, 'notes:write')).toBe(false);
  });

  it('returns false for null actor', () => {
    expect(hasScope(null, 'notes:read')).toBe(false);
  });

  it('returns false for actor without scopes', () => {
    expect(hasScope({}, 'notes:read')).toBe(false);
  });
});

describe('assertScope', () => {
  it('returns 401 when actor is null', () => {
    const result = assertScope(null, 'notes:read');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it('returns 403 when scope is missing', () => {
    const result = assertScope({ scopes: ['notes:read'] }, 'notes:write');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toContain('notes:write');
  });

  it('returns ok when scope is present', () => {
    const result = assertScope({ scopes: ['notes:read'] }, 'notes:read');
    expect(result.ok).toBe(true);
  });
});
