/**
 * The history of a note, as a list a person can scan.
 *
 * Every canonical save already lands in `note_versions` (trigger from migration 012):
 * revision, title, content, source, actor_id, created_at. Nothing read that table
 * until now, so the app could say "saved" but not "who saved what, when".
 *
 * Bodies stay out of the list. A version carries its size and the line delta against
 * the version before it, which is enough to see "the agent added 12 lines at 14:02"
 * without shipping the note six times. Content is fetched one version at a time.
 */

/** Word count, matching how the rest of the app counts. */
export function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Lines added and removed between two versions.
 * Multiset comparison, not a diff algorithm: the question a person asks is
 * "how much moved", not "which exact line".
 */
export function lineDelta(before, after) {
  const tally = (text) => {
    const map = new Map();
    for (const line of String(text || '').split('\n')) {
      if (!line.trim()) continue;
      map.set(line, (map.get(line) || 0) + 1);
    }
    return map;
  };
  const oldLines = tally(before);
  const newLines = tally(after);
  let added = 0;
  let removed = 0;
  for (const [line, n] of newLines) added += Math.max(0, n - (oldLines.get(line) || 0));
  for (const [line, n] of oldLines) removed += Math.max(0, n - (newLines.get(line) || 0));
  return { added, removed };
}

/** Who wrote a version, in the same vocabulary the note metadata uses. */
export function actorOf(row) {
  const id = row?.actor_id || null;
  if (!id) return 'unknown';
  if (id === 'agent' || String(id).startsWith('agent_')) return 'agent';
  return 'human';
}

/**
 * Turn database rows into the list the panel renders, oldest last.
 * `previousContent` is optional: without it there is no delta, and the version is
 * reported with its size only.
 */
export function shapeHistory(rows, { limit = 30 } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const sorted = [...list].sort((a, b) =>
    String(b.created_at || '').localeCompare(String(a.created_at || ''))
  );
  const items = sorted.slice(0, limit).map((row, index) => {
    const words = countWords(row.content);
    // Each version is compared with the one before it, newest first, so the list
    // answers "what did this change" without asking for the previous body.
    const older = sorted[index + 1];
    const delta = older ? lineDelta(older.content, row.content) : null;
    return {
      revision: row.revision ?? null,
      at: row.created_at || null,
      title: row.title || null,
      source: row.source || 'unknown',
      actor: actorOf(row),
      words,
      chars: String(row.content || '').length,
      added: delta ? delta.added : null,
      removed: delta ? delta.removed : null,
    };
  });
  return { count: items.length, hasMore: sorted.length > items.length, items };
}
