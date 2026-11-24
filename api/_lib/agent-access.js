/**
 * Per-note agent access.
 *
 * The global switch decides whether agents can enter the notebook at all. This one
 * decides, note by note, whether they can see it. A note that is off is not
 * "read-only" and not "hidden from lists but readable by id" — it behaves exactly
 * like a note that does not exist, because a 404 tells the agent nothing about what
 * it is missing, and a 403 would leak the existence of the note.
 *
 * The flag is stored as `agent_access` (migration 015); the in-memory reference
 * server carries the same value as `agentAccess`. One accessor reads both, so the
 * two surfaces cannot drift apart.
 */

export const AGENT_ACCESS_COLUMN = 'agent_access';

/** The stored value, from a database row or a reference-server note. Undefined = allowed. */
export function agentAccessOf(row) {
  if (!row) return false;
  const raw = row.agent_access !== undefined ? row.agent_access : row.agentAccess;
  return raw !== false;
}

/** A note is agent-visible unless it was explicitly turned off. No row, no note. */
export function isVisibleToAgent(row) {
  return Boolean(row) && agentAccessOf(row);
}

/** Drop the notes that are switched off. Order is preserved. */
export function filterAgentVisible(rows) {
  return Array.isArray(rows) ? rows.filter(isVisibleToAgent) : [];
}

/**
 * Should the agent be told this note does not exist?
 * Used by the single-note path so an off note and a missing note look identical.
 */
export function hidesFromAgent(row) {
  return !isVisibleToAgent(row);
}
