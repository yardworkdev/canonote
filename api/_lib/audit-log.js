/**
 * Reading the agent audit trail.
 *
 * Slice 4's audit item: the events were written and nothing could read them.
 * `writeAuditEvent` (api/_lib/agent-handler.js) has recorded every note
 * mutation an agent made since the note routes landed, and `agent_audit_log`
 * had no owner column — so the only read it could support was "every event
 * from every user", which is a leak rather than a feature. Migration 014 adds
 * `user_id`, the write records it, and this module is the one read:
 * **the events on the notes one user owns, newest first, capped**.
 *
 * The scope is the owner, not the actor. A delegated agent token and the person
 * who issued it read the same trail, because the trail is about the notes; an
 * actor-scoped read would answer "what did I do" and hide a second agent the
 * same user connected.
 *
 * A token with no owner (`AGENT_OWNER_USER_ID` unset on a static token) has no
 * trail to read, and says so instead of answering an empty list — "no events"
 * and "this token owns nothing" are different facts, and only one of them is
 * true.
 */

/** How many events one read returns unless the caller asks for fewer. */
export const AUDIT_DEFAULT_LIMIT = 100;

/** The ceiling, so one request cannot ask for the whole table. */
export const AUDIT_MAX_LIMIT = 200;

/** `?limit=` — a positive integer, clamped, with the default for nonsense. */
export function parseAuditLimit(value, fallback = AUDIT_DEFAULT_LIMIT, max = AUDIT_MAX_LIMIT) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

/**
 * One stored row, in the shape the API answers with. The column names are the
 * table's; the API's are its own so the reader is not coupled to the schema
 * (and so a rename in a migration is not a breaking change for an agent).
 */
export function auditEventView(row = {}) {
  return {
    eventId: row.event_id || null,
    noteId: row.note_key || null,
    actorId: row.actor_id || null,
    actorType: row.actor_type || null,
    action: row.action || null,
    beforeHash: row.before_hash || null,
    afterHash: row.after_hash || null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    createdAt: row.created_at || null,
  };
}

/**
 * The owner's trail, newest first.
 *
 * `{ ok: true, events, hasMore, limit }` on success; `{ ok: false, reason }`
 * otherwise, where `reason` is `no-owner` (nothing to scope the read to) or
 * `read-failed` (the store refused, e.g. the migration is not applied yet).
 * The caller decides the status: the two are a 403 and a 500, and collapsing
 * them would tell the reader the wrong thing about their own notebook.
 */
/**
 * @param {{ supabase?: any, userId?: string | null, limit?: number }} [options]
 */
export async function listAuditEvents({ supabase, userId, limit = AUDIT_DEFAULT_LIMIT } = {}) {
  const capped = parseAuditLimit(limit);

  if (!supabase || !userId) return { ok: false, reason: 'no-owner', events: [] };

  // One row past the cap is what answers `hasMore` without a second query.
  const { data, error } = await supabase
    .from('agent_audit_log')
    .select(
      'event_id, note_key, actor_id, actor_type, action, before_hash, after_hash, metadata, created_at'
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(capped + 1);

  if (error) return { ok: false, reason: 'read-failed', error, events: [] };

  const rows = Array.isArray(data) ? data : [];
  const hasMore = rows.length > capped;
  return {
    ok: true,
    events: rows.slice(0, capped).map(auditEventView),
    hasMore,
    limit: capped,
  };
}
