/**
 * The shared thread on a note.
 *
 * Prescriptions, not edits. The whole design is in this file's shape: a message
 * is a row, the agent proposes, the person applies, and applying is an ordinary
 * save that still has to win its revision. An agent that wants a change writes
 * it here instead of into the text, so "the agent cannot change your note
 * silently" stops depending on the agent behaving — the agent has no key to the
 * text at all unless its owner handed it one.
 *
 * Deliberately a table and not the in-memory presence store: a thread has to
 * survive a redeploy, two serverless instances and a person reopening the note
 * the next morning. Presence is a heartbeat; this is a conversation.
 *
 * The note's agent switch governs this whole route: a note switched off answers
 * 404 here too, because a thread that can be read and answered is existence, and
 * that is exactly what the switch refuses to confirm.
 */

export const MESSAGE_MAX_BYTES = 2000;
export const MESSAGES_PER_POLL = 50;
export const MESSAGE_KINDS = ['note', 'proposal', 'decision'];
const DEFAULT_POLL_MS = 5000;
const MAX_POLL_MS = 30000;

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export function createThread(supabase) {
  /**
   * Every message on a note, oldest first, capped by `limit`.
   *
   * `since` is the poll cursor and is a timestamp, not an id: two messages can
   * share a millisecond, and an id cursor would then skip one. The cost of a
   * quiet poll must stay near zero, which is why the route also returns
   * `nextCursor` so a caller can ask again without re-reading a page it already
   * has.
   *
   * @param {{ userId: string, noteId: string, since?: string|null, limit?: number }} args
   */
  async function list({ userId, noteId, since = null, limit = MESSAGES_PER_POLL }) {
    let query = supabase
      .from('note_messages')
      .select('id, note_id, author_type, author_name, kind, body, base_revision, created_at, applied_at, decided_at')
      .eq('user_id', userId)
      .eq('note_id', noteId)
      .order('created_at', { ascending: true })
      .limit(Math.min(Math.max(Number(limit) || MESSAGES_PER_POLL, 1), MESSAGES_PER_POLL));

    // Two things can change a message after the cursor was taken: it arrives,
    // or it is decided. Scanning only `created_at` means a proposal applied in
    // one tab keeps offering Apply in the other for ever — the second tab never
    // re-reads a row older than its cursor. So the poll asks for either, and the
    // cursor advances over both.
    if (since) query = query.or(`created_at.gt."${since}",decided_at.gt."${since}"`);

    const { data, error } = await query;
    if (error) throw new Error(`Could not read the thread: ${error.message}`);

    const messages = (data || []).map(toWire);
    return {
      messages,
      nextCursor: nextCursor(messages, since),
    };
  }

  /**
   * @param {{ userId: string, noteId: string, authorType: 'human'|'agent',
   *   authorName: string, kind?: string, body: string, baseRevision?: number|null }} args
   */
  async function post({ userId, noteId, authorType, authorName, kind = 'note', body, baseRevision = null }) {
    const text = String(body ?? '').trim();
    if (!text) throw new Error('A message cannot be empty');
    // Bytes, not characters: the cap is about what the reader pays to poll it.
    if (Buffer.byteLength(text, 'utf8') > MESSAGE_MAX_BYTES) {
      throw new Error(`A message cannot exceed ${MESSAGE_MAX_BYTES} bytes`);
    }
    if (!MESSAGE_KINDS.includes(kind)) {
      throw new Error(`kind must be one of ${MESSAGE_KINDS.join(', ')}`);
    }
    // A proposal names the revision it was written against. Without one it could
    // not say "this was written for a version of the note you have since changed",
    // and the person would be asked to apply a change nobody can place.
    if (kind === 'proposal' && !Number.isInteger(baseRevision)) {
      throw new Error('A proposal needs baseRevision: the note revision it was written against');
    }

    const { data, error } = await supabase
      .from('note_messages')
      .insert({
        user_id: userId,
        note_id: noteId,
        author_type: authorType,
        author_name: String(authorName || (authorType === 'agent' ? 'Agent' : 'You')).slice(0, 80),
        kind,
        body: text,
        base_revision: kind === 'proposal' ? baseRevision : null,
      })
      .select('id, note_id, author_type, author_name, kind, body, base_revision, created_at, applied_at, decided_at')
      .single();
    if (error) throw new Error(`Could not post to the thread: ${error.message}`);

    return toWire(data);
  }

  /**
   * Mark a proposal applied or dismissed. Only the note's owner can decide, and
   * only a proposal can be decided — a plain message has nothing to apply.
   */
  async function decide({ userId, noteId, messageId, applied }) {
    const { data, error } = await supabase
      .from('note_messages')
      .update({ applied_at: applied ? new Date().toISOString() : null, decided_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('note_id', noteId)
      .eq('id', messageId)
      .eq('kind', 'proposal')
      .select('id, note_id, author_type, author_name, kind, body, base_revision, created_at, applied_at, decided_at')
      .maybeSingle();
    if (error) throw new Error(`Could not record that decision: ${error.message}`);
    // A decision on something that is not there is not an error worth a 500: it is
    // a note that has nothing to apply, which the caller is told plainly.
    return data ? toWire(data) : null;
  }

  /**
   * The highest timestamp a caller has seen, over both what a message was
   * created at and when it was decided. Taking the last row's `createdAt` would
   * move the cursor backwards when an old row comes back because someone
   * decided it, and the poll would then re-read it on every tick.
   */
  function nextCursor(messages, since) {
    let best = since || null;
    for (const message of messages) {
      for (const stamp of [message.createdAt, message.decidedAt]) {
        if (!stamp) continue;
        if (!best || Date.parse(stamp) > Date.parse(best)) best = stamp;
      }
    }
    return best;
  }

  function toWire(row) {
    return {
      id: row.id,
      noteId: row.note_id,
      authorType: row.author_type,
      authorName: row.author_name,
      kind: row.kind,
      body: row.body,
      baseRevision: row.base_revision,
      createdAt: row.created_at,
      appliedAt: row.applied_at,
      decidedAt: row.decided_at ?? null,
    };
  }

  return { list, post, decide };
}

/** How long a poll interval a caller may ask for, clamped to something sane. */
export function parsePollMs(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_POLL_MS;
  return Math.min(Math.max(parsed, 1000), MAX_POLL_MS);
}

export { DEFAULT_POLL_MS };
