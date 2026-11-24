import crypto from 'node:crypto';

const DEFAULT_AGENT_SCOPES = ['notes:read', 'notes:write'];
const DEFAULT_USER_SCOPES = ['notes:read', 'notes:write'];

function safeEq(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function parseTokenMap(name) {
  const raw = process.env[name];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeScopes(value, fallback) {
  if (Array.isArray(value)) {
    const scopes = value.map((v) => String(v || '').trim()).filter(Boolean);
    return scopes.length > 0 ? scopes : fallback;
  }
  if (typeof value === 'string') {
    const scopes = value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    return scopes.length > 0 ? scopes : fallback;
  }
  return fallback;
}

function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function hashToken(token) {
  return crypto
    .createHash('sha256')
    .update(String(token || ''))
    .digest('hex');
}

async function findDelegatedConnection(supabase, token) {
  if (!supabase || !token) return null;

  try {
    const tokenHash = hashToken(token);
    const { data, error } = await supabase
      .from('agent_connections')
      .select('id, user_id, agent_id, agent_label, scopes, is_active, expires_at')
      .eq('token_hash', tokenHash)
      .eq('is_active', true)
      .limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return null;

    const connection = data[0];
    const expiresAt = toIsoOrNull(connection.expires_at);
    if (expiresAt && Date.now() >= new Date(expiresAt).getTime()) {
      return { expired: true, connection: null };
    }

    // Observability, not authorisation: the caller must not wait for a row
    // update on every read, and a failure here must not fail the request.
    void supabase
      .from('agent_connections')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', connection.id)
      .then(({ error }) => {
        if (error) console.warn('Could not record token use:', error.message);
      });

    return { expired: false, connection };
  } catch {
    return null;
  }
}

// The agent API takes credentials from headers only. A token in the query string
// was accepted here once and no longer is: a URL travels into access logs, proxy
// logs, `Referer` headers and browser history, so a credential that rides in one
// is a credential published. `?token=` is answered as if no token were sent, so
// the caller gets the same 401 an unauthenticated request gets.
export function getBearerToken(req) {
  const authHeader = req.headers?.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  const headerToken = String(req.headers?.['x-agent-token'] || '').trim();
  if (headerToken) return headerToken;

  return null;
}

export async function authenticateToken({ token, supabase }) {
  if (!token) return { actor: null, error: null };

  const scopedTokenMap = parseTokenMap('AGENT_TOKEN_SCOPES_JSON');
  const expiryMap = parseTokenMap('AGENT_TOKEN_EXPIRATIONS_JSON');
  const ownerId = process.env.AGENT_OWNER_USER_ID?.trim() || null;

  const envTokens = [process.env.AGENT_API_TOKEN || '', process.env.AGENT_API_TOKENS || '']
    .join(',')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  for (const envToken of envTokens) {
    if (!safeEq(token, envToken)) continue;
    const expiresAt = toIsoOrNull(expiryMap[envToken]);
    if (expiresAt && Date.now() >= new Date(expiresAt).getTime()) {
      return { actor: null, error: 'expired' };
    }
    return {
      actor: {
        type: 'agent',
        id: 'agent_rudi',
        name: 'Rudi',
        userId: ownerId,
        token,
        scopes: normalizeScopes(scopedTokenMap[envToken], DEFAULT_AGENT_SCOPES),
        expiresAt,
      },
      error: null,
    };
  }

  const delegated = await findDelegatedConnection(supabase, token);
  if (delegated?.expired) {
    return { actor: null, error: 'expired' };
  }
  if (delegated?.connection) {
    return {
      actor: {
        type: 'agent',
        id: delegated.connection.agent_id || 'agent_rudi',
        name: delegated.connection.agent_label || 'Rudi',
        userId: delegated.connection.user_id,
        token,
        scopes: normalizeScopes(delegated.connection.scopes, DEFAULT_AGENT_SCOPES),
        expiresAt: toIsoOrNull(delegated.connection.expires_at),
        connectionId: delegated.connection.id,
      },
      error: null,
    };
  }

  if (supabase?.auth?.getUser) {
    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data?.user?.id) {
        return {
          actor: {
            type: 'user',
            id: data.user.id,
            name: data.user.email || 'User',
            userId: data.user.id,
            token,
            scopes: DEFAULT_USER_SCOPES,
            expiresAt: null,
          },
          error: null,
        };
      }
    } catch {
      // noop
    }
  }

  return { actor: null, error: null };
}

export async function authenticateRequest({ req, supabase }) {
  const token = getBearerToken(req);
  if (!token) return { actor: null, error: null };
  return authenticateToken({ token, supabase });
}

export function hasScope(actor, scope) {
  return Boolean(actor?.scopes?.includes(scope));
}

export function assertScope(actor, scope) {
  if (!actor) {
    return { ok: false, status: 401, error: 'Unauthorized. Missing authentication token.' };
  }
  if (!hasScope(actor, scope)) {
    return { ok: false, status: 403, error: `Forbidden. Missing required scope: ${scope}` };
  }
  return { ok: true };
}

