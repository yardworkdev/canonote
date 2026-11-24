import { createClient } from '@supabase/supabase-js';
import { hidesFromAgent } from './agent-access.js';
import { authenticateToken } from './authz.js';
import { normalizeCanonicalNote } from './canonical-note.js';
import { canonicalRevision } from './canonical-note.js';
import { shapeHistory } from './note-history.js';

import { PRESENCE_TTL_MS } from './presence.js';
import { createSharedPresence } from './presence-shared.js';
import { createThread } from './thread.js';
import { guard, noteCreate, noteMessage, noteMessageDecision, noteRevert, noteUpdate } from './validate.js';
import { supabaseAnonKey, supabaseServiceKey, supabaseUrl } from './supabase-config.js';
import { applyCors } from './cors.js';
import { createNotesRepository } from './notes-repository.js';
import { createNotesService } from './notes-service.js';

const authSupabase =
  supabaseUrl && (supabaseServiceKey || supabaseAnonKey)
    ? createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey)
    : null;
const serviceSupabase =
  supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;
const thread = serviceSupabase ? createThread(serviceSupabase) : null;
const presence = createSharedPresence({ client: serviceSupabase });

const setCors = (req, res) => applyCors(req, res, { headers: 'Content-Type, Authorization, If-Match' });

function expectThread(res) {
  if (thread) return true;
  res.status(503).json({ success: false, error: 'Threads are not configured on this deployment' });
  return false;
}

function getPath(req, forcedPath) {
  if (forcedPath) return forcedPath;
  if (typeof req.query?.path === 'string' && req.query.path) return `/${req.query.path}`;
  if (Array.isArray(req.query?.path) && req.query.path.length > 0) {
    return `/${req.query.path.join('/')}`;
  }
  const rawPath = (req.url || '').split('?')[0];
  return rawPath.replace('/api/notes', '') || '/';
}

function makeSnippet(content, query, maxLen = 160) {
  if (!content || !query) return '';
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return content.slice(0, maxLen);
  const start = Math.max(0, idx - 40);
  const end = Math.min(content.length, start + maxLen);
  return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}

function getDbClient(actor) {
  // Service-role client bypasses RLS — every query MUST include .eq('user_id', actor.userId).
  if (serviceSupabase) return serviceSupabase;
  if (!supabaseUrl || !supabaseAnonKey || !actor?.token) return null;
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${actor.token}`,
      },
    },
  });
}

async function requireUser(req) {
  if (!authSupabase) {
    return { ok: false, status: 503, error: 'Service temporarily unavailable.' };
  }

  const authHeader = req.headers?.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const { actor, error } = await authenticateToken({ token, supabase: authSupabase });
  if (error === 'expired') {
    return { ok: false, status: 401, error: 'Unauthorized. Token expired.' };
  }
  if (!actor?.userId || actor.type !== 'user') {
    return { ok: false, status: 401, error: 'Unauthorized. Sign in to access notes.' };
  }

  const db = getDbClient(actor);
  if (!db) {
    return { ok: false, status: 503, error: 'Supabase database client is not configured.' };
  }

  return { ok: true, actor, db };
}

function ifRevisionFromRequest(req, body = {}) {
  if (typeof body.ifRevision === 'string' && body.ifRevision.trim()) {
    return body.ifRevision.trim();
  }
  const header = req.headers?.['if-match'];
  if (typeof header !== 'string') return null;
  return header.replace(/^W\//, '').replace(/^"|"$/g, '').trim() || null;
}

async function searchNotes(db, userId, query) {
  const term = `%${query.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;

  const [titleRes, contentRes] = await Promise.all([
    db
      .from('notes')
      .select('note_id, title, updated_at, created_at, is_pinned, folder, version, created_by, created_by_name, updated_by, updated_by_name')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .ilike('title', term)
      .order('updated_at', { ascending: false })
      .limit(25),
    db
      .from('notes')
      .select('note_id, title, updated_at, created_at, is_pinned, folder, content, version, created_by, created_by_name, updated_by, updated_by_name')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .ilike('content', term)
      .order('updated_at', { ascending: false })
      .limit(25),
  ]);

  if (titleRes.error) throw titleRes.error;
  if (contentRes.error) throw contentRes.error;

  const seen = new Set();
  const results = [];

  for (const row of titleRes.data || []) {
    seen.add(row.note_id || row.id);
    results.push({ ...normalizeCanonicalNote(row), matchType: 'title', snippet: '' });
  }

  for (const row of contentRes.data || []) {
    const id = row.note_id || row.id;
    if (seen.has(id)) continue;
    seen.add(id);
    results.push({
      ...normalizeCanonicalNote(row),
      matchType: 'content',
      snippet: makeSnippet(row.content || '', query),
    });
  }

  return results.sort((a, b) => b.updated - a.updated);
}

/**
 * @param {import('http').IncomingMessage & { body?: any, query?: any }} req
 * @param {any} res
 * @param {{ forcedPath?: string }} [options]
 */
/** A malformed percent-escape is a bad request, not a crash. */
const decodePath = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

export async function handleNotes(req, res, { forcedPath } = /** @type {{ forcedPath?: string }} */ ({})) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = await requireUser(req);
  if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

  const path = getPath(req, forcedPath);
  const noteId = path.startsWith('/') ? decodePath(path.slice(1)) : '';
  if (noteId === null) {
    return res.status(400).json({ success: false, error: 'Invalid note id.' });
  }
  const repository = createNotesRepository(auth.db);
  const service = createNotesService(repository);

  try {
    if (req.method === 'GET' && path === '/') {
      const q = typeof req.query?.q === 'string' ? req.query.q.trim() : '';
      if (q) {
        const results = await searchNotes(auth.db, auth.actor.userId, q);
        return res.status(200).json({ success: true, data: results });
      }
      const notes = (await service.list(auth.actor.userId)).map((row) => normalizeCanonicalNote(row));
      return res.status(200).json({ success: true, data: notes });
    }

    // Server-side history: who changed the note and when. Bodies stay out of the
    // list; one version's content is fetched by asking for it, not by downloading
    // the whole history of a note.
    const historyMatch = path.match(/^\/(.+)\/history$/);
    if (req.method === 'GET' && historyMatch) {
      const targetId = decodePath(historyMatch[1]);
      if (!targetId) return res.status(400).json({ success: false, error: 'Invalid note id.' });
      const limit = Math.min(Math.max(Number.parseInt(req.query?.limit, 10) || 30, 1), 100);
      const { data, error } = await auth.db
        .from('note_versions')
        .select('revision, title, content, source, actor_id, created_at')
        .eq('user_id', auth.actor.userId)
        .eq('note_id', targetId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      const history = shapeHistory(data || [], { limit });
      return res.status(200).json({ success: true, data: history });
    }

    // Put the note back the way a server version left it. The revert is itself a
    // new version made by the person, so nothing is erased: history keeps the
    // agent's text and the undo of it, in that order, with both authors.
    const revertMatch = path.match(/^\/(.+)\/revert$/);
    if (req.method === 'POST' && revertMatch) {
      const targetId = decodePath(revertMatch[1]);
      if (!targetId) return res.status(400).json({ success: false, error: 'Invalid note id.' });
      const parsed = guard(res, noteRevert, req.body);
      if (!parsed.ok) return undefined;

      const { data: version, error: versionError } = await auth.db
        .from('note_versions')
        .select('revision, title, content, created_at')
        .eq('user_id', auth.actor.userId)
        .eq('note_id', targetId)
        .eq('revision', parsed.value.revision)
        .maybeSingle();
      if (versionError) throw versionError;
      if (!version) return res.status(404).json({ success: false, error: 'No such version' });

      const current = await service.get(auth.actor.userId, targetId).catch((error) => {
        if (error?.code === 'NOTE_NOT_FOUND') return null;
        throw error;
      });
      if (!current) return res.status(404).json({ success: false, error: 'Note not found' });

      const row = await service.update(
        auth.actor,
        targetId,
        { content: version.content },
        canonicalRevision(current)
      );
      const note = normalizeCanonicalNote(row, { includeContent: true });
      res.setHeader('ETag', `"${note.revision}"`);
      return res.status(200).json({ success: true, data: note });
    }

    // The thread on this note. The person reads it and talks in it; the agent
    // reaches its own copy of the same rows through /api/agent. Reads carry the
    // poll cursor so a quiet note costs one empty answer, not a page.
    const messagesMatch = path.match(/^\/(.+)\/messages$/);
    if (req.method === 'GET' && messagesMatch) {
      const targetId = decodePath(messagesMatch[1]);
      if (!targetId) return res.status(400).json({ success: false, error: 'Invalid note id.' });
      if (!expectThread(res)) return undefined;

      const rawSince = typeof req.query?.since === 'string' ? req.query.since.trim() : null;
      let since = null;
      if (rawSince) {
        const parsed = Date.parse(rawSince);
        if (Number.isNaN(parsed)) {
          return res
            .status(400)
            .json({ success: false, error: 'since must be an ISO 8601 timestamp' });
        }
        since = new Date(parsed).toISOString();
      }
      const { messages, nextCursor } = await thread.list({
        userId: auth.actor.userId,
        noteId: targetId,
        since,
      });
      return res.status(200).json({ success: true, data: messages, pageInfo: { since: nextCursor } });
    }

    if (req.method === 'POST' && messagesMatch) {
      const targetId = decodePath(messagesMatch[1]);
      if (!targetId) return res.status(400).json({ success: false, error: 'Invalid note id.' });
      if (!expectThread(res)) return undefined;

      const parsed = guard(res, noteMessage, req.body);
      if (!parsed.ok) return undefined;

      // The note must be the person's own. A thread on a note they cannot open
      // would be a way to write rows against someone else's note id.
      const current = await service.get(auth.actor.userId, targetId).catch((error) => {
        if (error?.code === 'NOTE_NOT_FOUND') return null;
        throw error;
      });
      if (!current) return res.status(404).json({ success: false, error: 'Note not found' });

      const message = await thread.post({
        userId: auth.actor.userId,
        noteId: targetId,
        authorType: 'human',
        authorName: auth.actor?.email || 'You',
        kind: parsed.value.kind || 'note',
        body: parsed.value.body,
        baseRevision: parsed.value.baseRevision ?? null,
      });
      return res.status(201).json({ success: true, data: message });
    }

    // Answering a proposal. Applying it is the person's ordinary save: this route
    // only records that they said yes, so the text still has to win its revision
    // through the editor and a stale pick says so instead of overwriting a change
    // the agent never saw.
    const decisionMatch = path.match(/^\/(.+)\/messages\/([^/]+)$/);
    if (req.method === 'POST' && decisionMatch) {
      const targetId = decodePath(decisionMatch[1]);
      const messageId = decisionMatch[2];
      if (!targetId || !messageId) {
        return res.status(400).json({ success: false, error: 'Invalid note or message id.' });
      }
      if (!expectThread(res)) return undefined;

      const parsed = guard(res, noteMessageDecision, req.body);
      if (!parsed.ok) return undefined;

      const decided = await thread.decide({
        userId: auth.actor.userId,
        noteId: targetId,
        messageId,
        applied: parsed.value.applied,
      });
      if (!decided) {
        return res.status(404).json({ success: false, error: 'No such proposal' });
      }
      return res.status(200).json({ success: true, data: decided });
    }

    // Who is in this note right now. Presence carries no body and no history:
    // it is a caret and a mode, and it is gone in twelve seconds. The store is
    // shared, so this answers for carets announced through the agent route too.
    //
    // This route and `/api/agent/notes/:id/presence` are one promise with two
    // paths, so they answer alike: a note that is missing, deleted or switched
    // off is a 404 here as well. It used to answer 200 with `revision: null`,
    // which told a caller nothing — the same empty answer a live note with
    // nobody in it gives — and a deleted note kept reporting its last revision
    // forever. Presence must never disclose a note, and must never deny one.
    const presenceMatch = path.match(/^\/(.+)\/presence$/);
    if (req.method === 'GET' && presenceMatch) {
      const targetId = decodePath(presenceMatch[1]);
      if (!targetId) return res.status(400).json({ success: false, error: 'Invalid note id.' });
      const meta = await service.meta(auth.actor.userId, targetId);
      if (!meta || hidesFromAgent(meta)) {
        return res.status(404).json({ success: false, error: 'Note not found' });
      }
      // The caller here is always the person (this handler refuses anything
      // else), and a person's own caret is not news to them: the agent route
      // already drops it, and drawing a mark of themselves reads as a stranger.
      const entries = (await presence.list(auth.actor.userId, targetId)).filter(
        (entry) => entry.kind !== 'person'
      );
      return res.status(200).json({
        success: true,
        data: {
          ttl: PRESENCE_TTL_MS,
          // The poll already happens every three seconds while a note is open,
          // so the note's revision rides along. That is what lets an open editor
          // notice an agent's write without a second request, a socket or a
          // webhook: the caret poll carries the one number that says "the text
          // moved". It comes from the row this answer already read.
          revision: canonicalRevision(meta),
          entries,
        },
      });
    }

    if (req.method === 'GET' && noteId) {
      const row = await service.get(auth.actor.userId, noteId).catch((error) => {
        if (error?.code === 'NOTE_NOT_FOUND') return null;
        throw error;
      });
      if (!row) return res.status(404).json({ success: false, error: 'Note not found' });
      const note = normalizeCanonicalNote(row, { includeContent: true });

      res.setHeader('ETag', `"${note.revision}"`);
      return res.status(200).json({ success: true, data: note });
    }

    if (req.method === 'POST' && path === '/') {
      const parsed = guard(res, noteCreate, req.body);
      if (!parsed.ok) return undefined;
      const row = await service.create(auth.actor, parsed.value);
      const note = normalizeCanonicalNote(row, { includeContent: true });
      res.setHeader('ETag', `"${note.revision}"`);
      return res.status(201).json({ success: true, data: note });
    }

    if (req.method === 'PATCH' && noteId) {
      const parsed = guard(res, noteUpdate, req.body);
      if (!parsed.ok) return undefined;
      const body = parsed.value;
      const changes = {};
      if (typeof body.title === 'string') changes.title = body.title.trim() || 'Untitled';
      if (typeof body.content === 'string') changes.content = body.content;
      if (typeof body.isPinned === 'boolean') changes.is_pinned = body.isPinned;
      // The per-note agent switch. Only the person who owns the note can flip it,
      // and only through this route: the agent API has no way to turn itself back on.
      if (typeof body.agentAccess === 'boolean') changes.agent_access = body.agentAccess;
      try {
        const row = await service.update(
          auth.actor,
          noteId,
          changes,
          ifRevisionFromRequest(req, body)
        );
        const note = normalizeCanonicalNote(row, { includeContent: true });
        res.setHeader('ETag', `"${note.revision}"`);
        return res.status(200).json({ success: true, data: note });
      } catch (error) {
        // A database that never got migration 015 cannot store the switch. Say
        // which migration is missing instead of relaying Postgres at the user.
        const message = String(error?.message || '');
        if (error?.code === '42703' || /agent_access/.test(message)) {
          return res.status(503).json({
            success: false,
            code: 'SCHEMA_MISSING',
            error:
              'This database is missing migration 015 (notes.agent_access), so the per-note agent switch cannot be saved yet.',
          });
        }
        if (!error?.code) throw error;
        return res.status(error.status).json({
          success: false,
          error: error.message,
          data: error.currentNote,
          currentRevision: error.currentNote?.revision || null,
          code: error.code,
        });
      }
    }

    if (req.method === 'DELETE' && noteId) {
      const body = req.body || {};
      try {
        const row = await service.remove(
          auth.actor,
          noteId,
          ifRevisionFromRequest(req, body)
        );
        return res.status(200).json({ success: true, data: normalizeCanonicalNote(row) });
      } catch (error) {
        if (!error?.code) throw error;
        return res.status(error.status).json({
          success: false,
          error: error.message,
          data: error.currentNote,
          currentRevision: error.currentNote?.revision || null,
          code: error.code,
        });
      }
    }

    return res.status(404).json({ success: false, error: 'Not found' });
  } catch (error) {
    // A Postgres message names tables and constraints. It goes to the log, not
    // to the browser: the client gets a sentence and the status, nothing more.
    console.error('Notes API error:', error);
    return res.status(500).json({
      success: false,
      error: 'The notebook could not complete that request.',
    });
  }
}
