import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { applyCors } from './cors.js';
import { assertScope, authenticateRequest } from './authz.js';
import { VERSION } from './version.js';
import { canonicalRevision } from './canonical-note.js';
import { supabaseServiceKey, supabaseUrl } from './supabase-config.js';
import { createNotesRepository } from './notes-repository.js';
import { createNotesService } from './notes-service.js';
import { AGENT_FOLDER, DEFAULT_AGENT_ID, DEFAULT_AGENT_NAME, TOKEN_PREFIX } from './agent-identity.js';
import { listAuditEvents, parseAuditLimit } from './audit-log.js';
import { filterAgentVisible, hidesFromAgent } from './agent-access.js';
import { PRESENCE_TTL_MS, PERSON_ACTOR_ID } from './presence.js';
import { createSharedPresence } from './presence-shared.js';
import { createThread } from './thread.js';
import { agentConnection, agentCreateNote, agentPresence, agentUpdateNote, guard, noteMessage, personPresence } from './validate.js';

const supabase = supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;
const notesRepository = supabase ? createNotesRepository(supabase) : null;
const notesService = notesRepository ? createNotesService(notesRepository) : null;
const thread = supabase ? createThread(supabase) : null;
// One caret store for every function and every warm instance: Postgres when this
// deployment has a database, this process's memory when it does not.
const presence = createSharedPresence({ client: supabase });
const ALLOWED_CONNECTION_SCOPES = new Set(['notes:read', 'notes:write']);
const DEFAULT_CONNECTION_SCOPES = ['notes:read', 'notes:write'];
const MAX_ACTIVE_CONNECTIONS_PER_USER = Number.parseInt(
  process.env.AGENT_MAX_CONNECTIONS_PER_USER || '5',
  10
);
const MAX_CONNECTION_TTL_MS = Number.parseInt(
  process.env.AGENT_MAX_CONNECTION_TTL_MS || String(180 * 24 * 60 * 60 * 1000),
  10
);

const setCors = (req, res) => applyCors(req, res);

/**
 * The thread is a table, so a deployment that has not run migration 021 gets a
 * sentence instead of a 500. Saying which thing is missing is the difference
 * between "the notebook is broken" and "run the migration".
 */
function expectThread() {
  if (thread) return;
  throw requestError(503, 'Threads are not configured on this deployment (database missing)');
}

function parsePath(req) {
  if (typeof req.query?.path === 'string' && req.query.path) return `/${req.query.path}`;
  if (Array.isArray(req.query?.path) && req.query.path.length > 0)
    return `/${req.query.path.join('/')}`;

  const rawPath = (req.url || '').split('?')[0];
  const stripped = rawPath.replace('/api/agent', '');
  return stripped || '/';
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * An error the caller can act on. The handler answers it with the status it
 * carries instead of a 500, because "your request cannot be satisfied" is not a
 * server fault — and a stranger reading the API docs has to be able to tell the
 * two apart. `status` is the only field a caller sees; the message is written to
 * be shown.
 */
function requestError(status, message) {
  const error = new Error(message);
  /** @type {any} */ (error).status = status;
  return error;
}

function hashToken(token) {
  return crypto
    .createHash('sha256')
    .update(String(token || ''))
    .digest('hex');
}

function createDelegatedToken() {
  return `${TOKEN_PREFIX}_${crypto.randomBytes(24).toString('base64url')}`;
}

function sanitizeConnection(connection) {
  if (!connection) return null;
  return {
    id: connection.id,
    userId: connection.user_id,
    agentId: connection.agent_id,
    agentLabel: connection.agent_label,
    scopes: Array.isArray(connection.scopes) ? connection.scopes : [],
    isActive: Boolean(connection.is_active),
    tokenPrefix: connection.token_prefix || null,
    lastUsedAt: connection.last_used_at || null,
    expiresAt: connection.expires_at || null,
    createdAt: connection.created_at || null,
    updatedAt: connection.updated_at || null,
  };
}

async function listAgentConnections(userId) {
  const { data, error } = await supabase
    .from('agent_connections')
    .select('*')
    .eq('user_id', userId)
    // A revoked token is not a token. Its history stays in
    // agent_connection_events, but listing it again would suggest it can still
    // be used, and the revocation would look like it did nothing.
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(sanitizeConnection);
}

function normalizeConnectionScopes(scopes) {
  const values = Array.isArray(scopes) ? scopes : DEFAULT_CONNECTION_SCOPES;
  const normalized = values
    .map((value) => String(value || '').trim())
    .filter((value) => ALLOWED_CONNECTION_SCOPES.has(value));
  return Array.from(new Set(normalized));
}

function validateConnectionRequest({ scopes, expiresAt }) {
  const normalizedScopes = normalizeConnectionScopes(scopes);
  if (normalizedScopes.length === 0) {
    return { ok: false, error: 'At least one valid scope is required for a delegated connection.' };
  }

  let normalizedExpiresAt = null;
  if (expiresAt) {
    const expiresDate = new Date(expiresAt);
    const expiresMs = expiresDate.getTime();
    if (!Number.isFinite(expiresMs)) {
      return { ok: false, error: 'Invalid expiresAt value.' };
    }
    if (expiresMs <= Date.now()) {
      return { ok: false, error: 'Delegated connection expiry must be in the future.' };
    }
    if (expiresMs - Date.now() > MAX_CONNECTION_TTL_MS) {
      return {
        ok: false,
        error: 'Delegated connection expiry exceeds the maximum allowed lifetime.',
      };
    }
    normalizedExpiresAt = expiresDate.toISOString();
  }

  return {
    ok: true,
    scopes: normalizedScopes,
    expiresAt: normalizedExpiresAt,
  };
}

async function countActiveAgentConnections(userId) {
  const { count, error } = await supabase
    .from('agent_connections')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_active', true);
  if (error) throw error;
  return count || 0;
}

async function writeAgentConnectionEvent({ connectionId, userId, actorId, action, metadata = {} }) {
  try {
    await supabase.from('agent_connection_events').insert([
      {
        connection_id: connectionId,
        user_id: userId,
        actor_id: actorId,
        action,
        metadata,
      },
    ]);
  } catch (error) {
    if (
      String(error?.message || '')
        .toLowerCase()
        .includes('agent_connection_events')
    ) {
      return;
    }
    console.warn('Agent connection event skipped:', error?.message || error);
  }
}

async function createAgentConnection({ userId, agentLabel, scopes, expiresAt }) {
  const activeConnections = await countActiveAgentConnections(userId);
  if (activeConnections >= MAX_ACTIVE_CONNECTIONS_PER_USER) {
    throw requestError(
      429,
      `Active delegated connection limit reached (${MAX_ACTIVE_CONNECTIONS_PER_USER}). Revoke one before issuing another.`
    );
  }

  const validation = validateConnectionRequest({ scopes, expiresAt });
  if (!validation.ok) {
    throw requestError(400, validation.error);
  }

  const token = createDelegatedToken();
  const tokenHash = hashToken(token);
  const tokenPrefix = token.slice(0, 12);

  const { data, error } = await supabase
    .from('agent_connections')
    .insert([
      {
        user_id: userId,
        agent_id: DEFAULT_AGENT_ID,
        agent_label: agentLabel || DEFAULT_AGENT_NAME,
        token_hash: tokenHash,
        token_prefix: tokenPrefix,
        scopes: validation.scopes,
        expires_at: validation.expiresAt,
        is_active: true,
      },
    ])
    .select('*')
    .single();
  if (error) throw error;
  await writeAgentConnectionEvent({
    connectionId: data.id,
    userId,
    actorId: userId,
    action: 'issued',
    metadata: {
      scopes: validation.scopes,
      expiresAt: validation.expiresAt,
      tokenPrefix,
    },
  });
  return {
    connection: sanitizeConnection(data),
    token,
  };
}

async function revokeAgentConnection({ connectionId, userId }) {
  const { data, error } = await supabase
    .from('agent_connections')
    .update({ is_active: false, updated_at: nowIso() })
    .eq('id', connectionId)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) {
    // PostgREST answers `PGRST116` when `.single()` matched no row: the id is
    // unknown, or the connection belongs to somebody else. Either way the caller
    // asked for something that is not there — not a server fault.
    if (error.code === 'PGRST116') throw requestError(404, 'Connection not found.');
    throw error;
  }
  await writeAgentConnectionEvent({
    connectionId,
    userId,
    actorId: userId,
    action: 'revoked',
    metadata: {},
  });
  return sanitizeConnection(data);
}

async function revokeAllAgentConnections({ userId }) {
  const { data, error } = await supabase
    .from('agent_connections')
    .update({ is_active: false, updated_at: nowIso() })
    .eq('user_id', userId)
    .eq('is_active', true)
    .select('*');
  if (error) throw error;
  await Promise.all(
    (data || []).map((connection) =>
      writeAgentConnectionEvent({
        connectionId: connection.id,
        userId,
        actorId: userId,
        action: 'revoked_all',
        metadata: {},
      })
    )
  );
  return (data || []).map(sanitizeConnection);
}

function makeNoteId() {
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseLimit(value, fallback = 200, max = 500) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

const makeRevision = canonicalRevision;

function makeContentHash(note) {
  const payload = `${note?.title || ''}\n${note?.content || ''}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function parseCursor(rawCursor) {
  if (!rawCursor || typeof rawCursor !== 'string') return null;
  try {
    const decoded = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8'));
    if (!decoded?.updatedAt || !decoded?.key) return null;
    return {
      updatedAt: String(decoded.updatedAt),
      key: String(decoded.key),
    };
  } catch {
    return null;
  }
}

function encodeCursor(updatedAt, key) {
  return Buffer.from(
    JSON.stringify({
      updatedAt,
      key,
    }),
    'utf8'
  ).toString('base64url');
}

function applyCursorFilter(rows, cursor, keyColumn) {
  if (!cursor) return rows;
  return rows.filter((row) => {
    const updatedAt = String(row?.updated_at || '');
    const key = String(row?.[keyColumn] || '');
    if (updatedAt < cursor.updatedAt) return true;
    if (updatedAt > cursor.updatedAt) return false;
    return key < cursor.key;
  });
}

function withRevision(note) {
  if (!note) return null;
  if (typeof note.revision === 'string') return note;
  return { ...note, revision: makeRevision(note) };
}

async function listAllAuthUsers() {
  if (!supabase?.auth?.admin?.listUsers) {
    throw new Error('Supabase admin API unavailable. Use service-role key for stats.');
  }

  const perPage = 1000;
  let page = 1;
  const users = [];

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const batch = Array.isArray(data?.users) ? data.users : [];
    users.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }

  return users;
}

async function collectStats() {
  // Aggregate notes in pages to avoid large single-result queries.
  const pageSize = 1000;
  let from = 0;
  let totalNotes = 0;
  const notesByUserMap = new Map();

  while (true) {
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) break;

    totalNotes += rows.length;
    for (const row of rows) {
      const uid = row?.user_id;
      if (!uid) continue;
      notesByUserMap.set(uid, (notesByUserMap.get(uid) || 0) + 1);
    }

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  const users = await listAllAuthUsers();
  const now = Date.now();
  const activeWindowMs = 30 * 24 * 60 * 60 * 1000;

  const usersWithCounts = users
    .map((user) => {
      const notesCount = notesByUserMap.get(user.id) || 0;
      return {
        id: user.id,
        email: user.email || null,
        createdAt: user.created_at || null,
        lastSignInAt: user.last_sign_in_at || null,
        notesCount,
      };
    })
    .sort((a, b) => b.notesCount - a.notesCount);

  const activeUsers30d = usersWithCounts.filter((user) => {
    if (!user.lastSignInAt) return false;
    const signInTs = new Date(user.lastSignInAt).getTime();
    return Number.isFinite(signInTs) && now - signInTs <= activeWindowMs;
  }).length;

  return {
    generatedAt: nowIso(),
    totals: {
      users: usersWithCounts.length,
      activeUsers30d,
      notes: totalNotes,
    },
  };
}

async function listNotesPage(userId, { limit = 200, cursor = null, since = null } = {}) {
  const safeLimit = parseLimit(limit, 200, 500);
  const querySize = Math.min(safeLimit * 3, 1000);
  const cursorParts = parseCursor(cursor);

  let q = supabase
    .from('notes')
    .select('*')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .order('note_id', { ascending: false })
    .limit(querySize);

  if (userId) q = q.eq('user_id', userId);

  if (cursorParts?.updatedAt) {
    q = q.lte('updated_at', cursorParts.updatedAt);
  }

  // `since` is the poll: only what changed after the last answer, so an agent that
  // wants to know what happened does not re-read the whole notebook every time.
  if (since) {
    q = q.gt('updated_at', since);
  }

  const { data, error } = await q;
  if (error) throw error;

  const visible = filterAgentVisible(data || []);
  const filtered = applyCursorFilter(visible, cursorParts, 'note_id');
  // Lists are metadata only. AGENT_CONTEXT.md promises 40 notes as metadata in
  // ~3.8 KB against 44 KB with bodies, and "entering the notebook must not cost a
  // context window" is the product. Selecting `*` shipped every body in the list:
  // 24 notes of this notebook cost 85 KB on the first call. `contentBytes` says
  // which ones are worth a second call without paying for the text.
  // Every list is paid for in an agent's context. The row carried user_id, the row
  // id, deleted_at, the version column and the span map: 560 bytes per note, 14 KB
  // for 25 notes, to say what changed and how big it is. Only what a next call needs.
  const items = filtered.slice(0, safeLimit).map((row) => ({
    id: row.note_id,
    title: row.title,
    revision: row.version === undefined || row.version === null ? null : String(row.version),
    updated_at: row.updated_at,
    created_at: row.created_at,
    tags: row.tags || [],
    contentBytes: typeof row.content === 'string' ? row.content.length : 0,
    written_by:
      row.updated_by_name || row.created_by_name || (row.created_by === 'agent' ? 'an agent' : 'you'),
  }));
  const hasMore = filtered.length > safeLimit;
  const last = items[items.length - 1] || null;

  return {
    items,
    pageInfo: {
      hasMore,
      nextCursor:
        hasMore && last ? encodeCursor(last.updated_at || '', last.note_id || '') : null,
      limit: safeLimit,
      // Hand this back as `since` on the next call. Taken when the answer was made,
      // not when the query ran, so nothing written during the query is skipped.
      since: nowIso(),
    },
  };
}

async function getNoteById(noteId, userId) {
  // The list is the first call an agent makes, so the identifier it carries back
  // must be the one every other route accepts. It used to be the row id, and
  // GET /notes/<that id> answered 404 — indistinguishable from a note switched off.
  const note = await notesRepository.findAny(userId, noteId);
  // A note switched off for agents must answer 404, not 403: what does not exist
  // cannot be enumerated, and the agent learns nothing about what it is missing.
  return note && !hidesFromAgent(note) ? note : null;
}

async function createNote({ title, content, userId, folder, agent }) {
  // A token with no owner has no notebook. Writing into "no owner" would mean
  // guessing whose notes these are, so it is refused before anything is written.
  if (!userId) {
    throw Object.assign(
      new Error('This token has no owner. Set AGENT_OWNER_USER_ID, or use a token issued from the app.'),
      { status: 403 }
    );
  }
  return notesService.create(
    { ...agent, userId, id: agent?.id || userId, name: agent?.name || DEFAULT_AGENT_NAME },
    { noteId: makeNoteId(), title, content, folder: folder || AGENT_FOLDER }
  );
}

async function updateNote({ noteId, userId, title, content, ifRevision, agent }) {
  // The identifier an agent got from the list is `note-...`, but the service writes
  // by row id. Handing it the reference it was given made every PATCH answer "Note
  // not found" even though GET found it: one route resolved the reference and the
  // other did not.
  const existing = await getNoteById(noteId, userId);
  if (!existing) return { status: 'not_found', note: null, previous: null, previousRevision: null };

  const previousRevision = makeRevision(existing);
  const updates = {};
  if (title !== undefined) updates.title = title;
  if (content !== undefined) updates.content = content;
  try {
    const note = await notesService.update(
      { ...agent, userId, id: agent?.id || userId },
      existing.note_id || noteId,
      updates,
      ifRevision
    );
    return { status: 'ok', note, previous: existing, previousRevision };
  } catch (error) {
    if (!error?.code) throw error;
    return {
      status:
        error.code === 'PRECONDITION_REQUIRED'
          ? 'precondition_required'
          : error.code === 'NOTE_NOT_FOUND'
            ? 'not_found'
            : 'conflict',
      note: error.currentNote,
      previous: existing,
      previousRevision: error.currentNote?.revision || previousRevision,
    };
  }
}

async function writeAuditEvent({ actor, action, note, beforeHash, afterHash, metadata = {} }) {
  try {
    const row = {
      event_id: crypto.randomUUID(),
      // The owner is what makes the trail readable (migration 014): the read is
      // scoped to the user whose notes the event is about, never to the actor.
      user_id: actor?.userId || null,
      note_key: note?.note_id || note?.id || null,
      actor_id: actor?.id || 'unknown',
      actor_type: actor?.type || 'unknown',
      action,
      before_hash: beforeHash || null,
      after_hash: afterHash || null,
      metadata,
      created_at: nowIso(),
    };
    await supabase.from('agent_audit_log').insert(row);
  } catch (error) {
    if (
      String(error?.message || '')
        .toLowerCase()
        .includes('agent_audit_log')
    ) {
      return;
    }
    console.warn('Agent audit write skipped:', error?.message || error);
  }
}

export async function handleAgent(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!supabase) {
    return res.status(503).json({
      success: false,
      error: 'Database not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.',
    });
  }

  const { actor: agent, error: authError } = await authenticateRequest({
    req,
    supabase,
  });

  if (authError === 'expired') {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized. Token expired.',
    });
  }

  if (!agent) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized. Provide a valid Bearer token (delegated agent token or Supabase JWT).',
    });
  }

  const path = parsePath(req);
  const userId = agent.userId;

  try {
    if (req.method === 'GET' && path === '/') {
      return res.status(200).json({
        success: true,
        data: {
          agent: agent.name,
          authType: agent.type,
          userId: userId || null,
          scopes: agent.scopes || [],
          expiresAt: agent.expiresAt || null,
          version: VERSION,
          routes: [
            'GET /api/agent',
            'GET /api/agent/notes',
            'GET /api/agent/notes/:noteId',
            'GET /api/agent/stats',
            'GET /api/agent/audit',
            'GET /api/agent/connections',
            'POST /api/agent/connections',
            'DELETE /api/agent/connections/:connectionId',
            'DELETE /api/agent/connections',
            'POST /api/agent/notes',
            'PATCH /api/agent/notes/:noteId',
          ],
        },
      });
    }

    if (req.method === 'GET' && path === '/connections') {
      if (agent.type !== 'user') {
        return res.status(403).json({
          success: false,
          error: 'Forbidden. Only authenticated users can list delegated agent connections.',
        });
      }

      const connections = await listAgentConnections(userId);
      return res.status(200).json({
        success: true,
        data: connections,
      });
    }

    if (req.method === 'POST' && path === '/connections') {
      if (agent.type !== 'user') {
        return res.status(403).json({
          success: false,
          error: 'Forbidden. Only authenticated users can create delegated agent connections.',
        });
      }

      const parsed = guard(res, agentConnection, req.body);
      if (!parsed.ok) return undefined;
      const { agentLabel, scopes, expiresAt } = parsed.value;
      const { connection, token } = await createAgentConnection({
        userId,
        agentLabel,
        scopes,
        expiresAt,
      });
      return res.status(201).json({
        success: true,
        data: {
          ...connection,
          token,
        },
      });
    }

    if (req.method === 'DELETE' && path.startsWith('/connections/')) {
      if (agent.type !== 'user') {
        return res.status(403).json({
          success: false,
          error: 'Forbidden. Only authenticated users can revoke delegated agent connections.',
        });
      }

      const connectionId = path.split('/')[2];
      if (!connectionId)
        return res.status(400).json({ success: false, error: 'Missing connectionId' });

      const connection = await revokeAgentConnection({ connectionId, userId });
      return res.status(200).json({
        success: true,
        data: connection,
      });
    }

    if (req.method === 'DELETE' && path === '/connections') {
      if (agent.type !== 'user') {
        return res.status(403).json({
          success: false,
          error: 'Forbidden. Only authenticated users can revoke delegated agent connections.',
        });
      }

      const connections = await revokeAllAgentConnections({ userId });
      return res.status(200).json({
        success: true,
        data: connections,
      });
    }

    if (req.method === 'GET' && path === '/stats') {
      if (agent.type !== 'user') {
        return res.status(403).json({
          success: false,
          error: 'Forbidden. Only authenticated users can access stats.',
        });
      }

      const scopeCheck = assertScope(agent, 'notes:read');
      if (!scopeCheck.ok) {
        return res.status(scopeCheck.status).json({ success: false, error: scopeCheck.error });
      }

      const stats = await collectStats();
      return res.status(200).json({
        success: true,
        data: stats,
      });
    }

    if (req.method === 'GET' && path === '/audit') {
      const scopeCheck = assertScope(agent, 'notes:read');
      if (!scopeCheck.ok) {
        return res.status(scopeCheck.status).json({ success: false, error: scopeCheck.error });
      }

      const result = await listAuditEvents({
        supabase,
        userId,
        limit: parseAuditLimit(req.query?.limit),
      });

      // "This token owns no notes" and "the store refused the read" are two
      // different answers, so they are two different statuses.
      if (!result.ok && result.reason === 'no-owner') {
        return res.status(403).json({
          success: false,
          error: 'Forbidden. This token is not attached to a user, so it has no audit trail to read.',
        });
      }
      if (!result.ok) {
        console.error('Agent audit read failed:', result.error?.message || result.error);
        return res.status(500).json({ success: false, error: 'Could not read the audit trail.' });
      }

      return res.status(200).json({
        success: true,
        data: result.events,
        pageInfo: {
          limit: result.limit,
          returned: result.events.length,
          hasMore: result.hasMore,
        },
      });
    }

    if (req.method === 'GET' && path === '/notes') {
      const scopeCheck = assertScope(agent, 'notes:read');
      if (!scopeCheck.ok) {
        return res.status(scopeCheck.status).json({ success: false, error: scopeCheck.error });
      }

      // Without an owner the query would have no user_id predicate and would
      // list every note in the database. A token that does not know whose
      // notebook it speaks for gets nothing.
      if (!userId) {
        return res.status(403).json({
          success: false,
          error: 'This token has no owner. Set AGENT_OWNER_USER_ID, or use a token issued from the app.',
        });
      }

      const limit = parseLimit(req.query?.limit, 200, 500);
      const cursor = typeof req.query?.cursor === 'string' ? req.query.cursor : null;

      const rawSince = typeof req.query?.since === 'string' ? req.query.since.trim() : null;
      let since = null;
      if (rawSince) {
        const parsed = Date.parse(rawSince);
        if (Number.isNaN(parsed)) {
          return res.status(400).json({
            success: false,
            error: 'since must be an ISO 8601 timestamp, e.g. 2026-11-11T12:00:00.000Z',
          });
        }
        since = new Date(parsed).toISOString();
      }

      const { items, pageInfo } = await listNotesPage(userId, { limit, cursor, since });
      return res.status(200).json({ success: true, data: items.map(withRevision), pageInfo });
    }

    // Where everyone is working. The store is Postgres now, so this answers for
    // the whole deployment: a caret announced here is readable from the notes
    // route and from any other warm instance.
    if (req.method === 'GET' && /^\/notes\/[^/]+\/presence$/.test(path)) {
      const noteId = path.split('/')[2];
      const readScope = assertScope(agent, 'notes:read');
      if (!readScope.ok) {
        return res.status(readScope.status).json({ success: false, error: readScope.error });
      }

      const note = await getNoteById(noteId, userId);
      if (!note) return res.status(404).json({ success: false, error: 'Note not found' });

      // The note's revision rides along with the caret poll. It is the one number
      // that says "the text moved", so an open editor can take a write that landed
      // elsewhere without a reload, a socket or a second request. Without it this
      // response was presence only, and the page never learned anything changed.
      //
      // A person reading their own note is not shown their own caret: they know
      // where they are typing, and a second mark of themselves on their screen
      // reads as a stranger.
      const entries = (await presence.list(userId, noteId)).filter(
        (entry) => !(agent.type === 'user' && entry.kind === 'person')
      );
      return res.status(200).json({
        success: true,
        data: {
          ttl: PRESENCE_TTL_MS,
          revision: withRevision(note).revision ?? null,
          entries,
        },
      });
    }

    // Where the agent is working. A note it cannot see answers 404 here as well,
    // so presence can never disclose a note that is switched off, and announcing
    // a caret never changes a revision.
    //
    // The same route carries the person's own caret (`type: 'user'`).
    if (req.method === 'POST' && /^\/notes\/[^/]+\/presence$/.test(path)) {
      const noteId = path.split('/')[2];
      const noteScope = assertScope(agent, 'notes:read');
      if (!noteScope.ok) {
        return res.status(noteScope.status).json({ success: false, error: noteScope.error });
      }

      const isPerson = agent.type === 'user';
      const parsed = guard(res, isPerson ? personPresence : agentPresence, req.body);
      if (!parsed.ok) return undefined;

      const note = await getNoteById(noteId, userId);
      if (!note) return res.status(404).json({ success: false, error: 'Note not found' });

      const entry = await presence.announce({
        userId,
        noteId,
        kind: isPerson ? 'person' : 'agent',
        actorId: isPerson ? PERSON_ACTOR_ID : agent.id || DEFAULT_AGENT_ID,
        actorName: isPerson ? agent.name || 'Someone' : agent.name || DEFAULT_AGENT_NAME,
        ...parsed.value,
      });
      return res.status(200).json({ success: true, data: entry });
    }

    // The shared thread. Read it before you write: this is where a change you
    // want to make belongs, and `kind: 'proposal'` is how you offer one instead of
    // putting it in the note. Presence says someone is here; the thread is what
    // you say to them, and it does not expire.
    if (req.method === 'GET' && /^\/notes\/[^/]+\/messages$/.test(path)) {
      const noteId = path.split('/')[2];
      const readScope = assertScope(agent, 'notes:read');
      if (!readScope.ok) {
        return res.status(readScope.status).json({ success: false, error: readScope.error });
      }
      expectThread();
      const note = await getNoteById(noteId, userId);
      if (!note) return res.status(404).json({ success: false, error: 'Note not found' });

      const rawSince = typeof req.query?.since === 'string' ? req.query.since.trim() : null;
      let since = null;
      if (rawSince) {
        const parsed = Date.parse(rawSince);
        if (Number.isNaN(parsed)) {
          return res.status(400).json({
            success: false,
            error: 'since must be an ISO 8601 timestamp, e.g. 2026-11-11T12:00:00.000Z',
          });
        }
        since = new Date(parsed).toISOString();
      }
      const { messages, nextCursor } = await thread.list({ userId, noteId, since });
      return res.status(200).json({ success: true, data: messages, pageInfo: { since: nextCursor } });
    }

    // Say something, or offer a change. A proposal carries the revision it was
    // written against: that is what lets the person be told "this was written for
    // a version you have changed" rather than handed text that no longer fits.
    if (req.method === 'POST' && /^\/notes\/[^/]+\/messages$/.test(path)) {
      const noteId = path.split('/')[2];
      const writeScope = assertScope(agent, 'notes:read');
      if (!writeScope.ok) {
        return res.status(writeScope.status).json({ success: false, error: writeScope.error });
      }
      expectThread();
      const parsed = guard(res, noteMessage, req.body);
      if (!parsed.ok) return undefined;

      const note = await getNoteById(noteId, userId);
      if (!note) return res.status(404).json({ success: false, error: 'Note not found' });

      const message = await thread.post({
        userId,
        noteId,
        authorType: 'agent',
        authorName: agent.name || DEFAULT_AGENT_NAME,
        kind: parsed.value.kind || 'note',
        body: parsed.value.body,
        baseRevision: parsed.value.baseRevision ?? null,
      });
      return res.status(201).json({ success: true, data: message });
    }

    if (req.method === 'GET' && path.startsWith('/notes/')) {
      const noteId = path.split('/')[2];
      if (!noteId) return res.status(400).json({ success: false, error: 'Missing noteId' });

      const noteScope = assertScope(agent, 'notes:read');
      if (!noteScope.ok) {
        return res.status(noteScope.status).json({ success: false, error: noteScope.error });
      }

      const note = await getNoteById(noteId, userId);
      if (!note) return res.status(404).json({ success: false, error: 'Note not found' });

      const noteWithRevision = withRevision(note);
      res.setHeader('ETag', `"${noteWithRevision.revision}"`);
      return res.status(200).json({ success: true, data: noteWithRevision });
    }

    if (req.method === 'POST' && path === '/notes') {
      const scopeCheck = assertScope(agent, 'notes:write');
      if (!scopeCheck.ok) {
        return res.status(scopeCheck.status).json({ success: false, error: scopeCheck.error });
      }

      const parsed = guard(res, agentCreateNote, req.body);
      if (!parsed.ok) return undefined;
      const { title, content, userId: bodyUserId, folder } = parsed.value;
      if (bodyUserId && bodyUserId !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: userId in body does not match authenticated user.',
        });
      }
      const effectiveUserId = userId || null;
      const note = await createNote({ title, content, userId: effectiveUserId, folder, agent });
      await writeAuditEvent({
        actor: agent,
        action: 'notes.create',
        note,
        beforeHash: null,
        afterHash: makeContentHash(note),
        metadata: { folder: note?.folder || null, title: note?.title || null },
      });
      const noteWithRevision = withRevision(note);
      res.setHeader('ETag', `"${noteWithRevision.revision}"`);
      return res.status(201).json({ success: true, data: noteWithRevision });
    }

    if (req.method === 'PATCH' && path.startsWith('/notes/')) {
      const noteId = path.split('/')[2];
      if (!noteId) return res.status(400).json({ success: false, error: 'Missing noteId' });

      const noteScope = assertScope(agent, 'notes:write');
      if (!noteScope.ok) {
        return res.status(noteScope.status).json({ success: false, error: noteScope.error });
      }

      const ifMatchHeader =
        typeof req.headers['if-match'] === 'string'
          ? req.headers['if-match'].replace(/^W\//, '').replace(/^"|"$/g, '')
          : null;
      const parsed = guard(res, agentUpdateNote, req.body);
      if (!parsed.ok) return undefined;
      const { title, content, ifRevision } = parsed.value;
      const expectedRevision =
        typeof ifRevision === 'string' && ifRevision.trim() ? ifRevision.trim() : ifMatchHeader;
      const result = await updateNote({
        noteId,
        userId,
        title,
        content,
        ifRevision: expectedRevision,
        agent,
      });

      if (result.status === 'not_found' || !result.note) {
        return res.status(404).json({ success: false, error: 'Note not found' });
      }
      if (result.status === 'precondition_required') {
        return res.status(428).json({
          success: false,
          error: 'Revision required. Read the note and retry with ifRevision.',
          currentRevision: result.previousRevision,
          data: result.note ? withRevision(result.note) : null,
        });
      }
      if (result.status === 'conflict') {
        return res.status(409).json({
          success: false,
          error: 'Revision conflict. Refresh and retry with the latest revision.',
          data: withRevision(result.note),
          currentRevision: result.previousRevision,
        });
      }

      await writeAuditEvent({
        actor: agent,
        action: 'notes.update',
        note: result.note,
        beforeHash: makeContentHash(result.previous),
        afterHash: makeContentHash(result.note),
        metadata: { noteId, title: result.note?.title || null },
      });
      const noteWithRevision = withRevision(result.note);
      res.setHeader('ETag', `"${noteWithRevision.revision}"`);
      return res.status(200).json({ success: true, data: noteWithRevision });
    }

    return res.status(404).json({ success: false, error: 'Not found' });
  } catch (error) {
    // A status on the error means the request could not be satisfied as written;
    // only a real fault is a 500, and only a real fault is logged as one.
    const status = Number.isInteger(error?.status) ? error.status : 500;
    if (status >= 500) {
      // A fault is ours to fix, and a Postgres message ("new row for relation
      // \"notes\" violates check constraint ...") is both unreadable and a small
      // disclosure of the schema. It goes to the log; the caller gets a sentence.
      console.error('Agent API error:', error);
      return res.status(500).json({ success: false, error: 'The notebook could not complete that request.' });
    }
    return res.status(status).json({
      success: false,
      error: error.message || 'Internal error',
    });
  }
}
