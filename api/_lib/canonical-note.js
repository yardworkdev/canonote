export function canonicalRevision(row) {
  if (row?.version === undefined || row?.version === null) {
    throw new Error('Notes schema is missing the required version column. Apply migration 010.');
  }
  return String(row.version);
}

export function normalizeCanonicalNote(row, { includeContent = false } = {}) {
  if (!row) return null;
  const updatedAt = row.updated_at || row.created_at || new Date().toISOString();
  const note = {
    id: row.note_id,
    note_id: row.note_id,
    title: row.title || 'Untitled',
    updated: new Date(updatedAt).getTime(),
    updated_at: updatedAt,
    created_at: row.created_at || null,
    isPinned: Boolean(row.is_pinned),
    // Per-note agent switch (migration 015). Undefined means allowed, which is the
    // column default: a row read before the migration behaves as it always did.
    agentAccess: row.agent_access !== false,
    folder: row.folder || 'private',
    createdBy: row.created_by || null,
    createdByName: row.created_by_name || null,
    updatedBy: row.updated_by || null,
    updatedByName: row.updated_by_name || null,
    revision: canonicalRevision(row),
    // Character ranges of this text that an agent wrote (migration 018). Written
    // with the text they describe, so they cannot drift.
    agentSpans: Array.isArray(row.agent_spans) ? row.agent_spans : [],
  };
  if (includeContent) note.content = typeof row.content === 'string' ? row.content : '';
  return note;
}
