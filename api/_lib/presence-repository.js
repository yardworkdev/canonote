/**
 * Presence in Postgres: the memory that every function and every instance shares.
 *
 * The in-memory store in `presence.js` is correct about what presence *is* — a
 * heartbeat with a timestamp, filtered on read — and wrong about where it lives.
 * A caret announced to one lambda was invisible to the next request that landed
 * elsewhere, so "where is the person typing" answered correctly only by luck.
 * This keeps the same rules and puts them in one row per (note, actor).
 *
 * Nothing here is authoritative. A row carries no note text and no access flag,
 * and every read filters on age, so a stale row can never be shown as a live one.
 */

import { AGENT_MODES, MAX_ENTRIES_PER_NOTE, PRESENCE_TTL_MS, PERSON_ACTOR_ID } from './presence.js';

export const PRESENCE_TABLE = 'note_presence';

const COLUMNS = 'kind, actor_id, name, mode, from_pos, to_pos, at';

/** A row as the API reads it back: the same shape the in-memory store returns. */
function toEntry(row) {
  const kind = row.kind === 'person' ? 'person' : 'agent';
  /** @type {any} */
  const entry = {
    kind,
    id: String(row.actor_id),
    name: String(row.name || (kind === 'person' ? 'Someone' : 'Agent')).slice(0, 24),
    from: Number.isInteger(row.from_pos) ? row.from_pos : null,
    to: Number.isInteger(row.to_pos) ? row.to_pos : null,
    at: Date.parse(row.at),
  };
  // A person has a caret, never a mode. Saying "reading" about someone who is
  // typing would be an invented fact in an agent's context.
  if (kind === 'agent') entry.mode = AGENT_MODES.includes(row.mode) ? row.mode : 'reading';
  return entry;
}

function unwrap(result, what) {
  if (result?.error) {
    const error = new Error(`presence ${what} failed: ${result.error.message || result.error}`);
    /** @type {any} */ (error).cause = result.error;
    throw error;
  }
  return result?.data;
}

/**
 * @param {any} client a Supabase client holding the service key
 */
export function createPresenceRepository(
  client,
  { ttl = PRESENCE_TTL_MS, now = () => Date.now(), maxPerNote = MAX_ENTRIES_PER_NOTE } = {}
) {
  const cutoff = () => new Date(now() - ttl).toISOString();

  return {
    /**
     * Record one heartbeat, pruned and capped so the table cannot grow past
     * `maxPerNote` rows per note no matter who announces.
     */
    async announce({ userId, noteId, actorId, actorName, kind = 'agent', mode, from, to }) {
      const entryKind = kind === 'person' ? 'person' : 'agent';
      const id = String(actorId || (entryKind === 'person' ? PERSON_ACTOR_ID : 'agent'));

      // A heartbeat is also the moment to forget: nobody else is going to prune
      // this note, and the row that has to go is the one older than the TTL.
      unwrap(
        await client
          .from(PRESENCE_TABLE)
          .delete()
          .eq('user_id', userId)
          .eq('note_id', noteId)
          .lt('at', cutoff()),
        'prune'
      );

      const live = unwrap(
        await client
          .from(PRESENCE_TABLE)
          .select('actor_id, at')
          .eq('user_id', userId)
          .eq('note_id', noteId)
          .gte('at', cutoff())
          .order('at', { ascending: true }),
        'cap-read'
      );

      const rows = Array.isArray(live) ? live : [];
      const alreadyHere = rows.some((row) => String(row.actor_id) === id);
      if (!alreadyHere && rows.length >= maxPerNote) {
        const room = rows.length - maxPerNote + 1;
        const oldest = rows.slice(0, room).map((row) => String(row.actor_id));
        if (oldest.length > 0) {
          unwrap(
            await client
              .from(PRESENCE_TABLE)
              .delete()
              .eq('user_id', userId)
              .eq('note_id', noteId)
              .in('actor_id', oldest),
            'cap-delete'
          );
        }
      }

      const written = unwrap(
        await client
          .from(PRESENCE_TABLE)
          .upsert(
            {
              user_id: userId,
              note_id: noteId,
              actor_id: id,
              kind: entryKind,
              name: String(actorName || (entryKind === 'person' ? 'Someone' : 'Agent')).slice(0, 24),
              // A person has no mode; storing one would be inventing a fact.
              mode: entryKind === 'agent' ? (AGENT_MODES.includes(mode) ? mode : 'reading') : null,
              from_pos: Number.isInteger(from) ? from : null,
              to_pos: Number.isInteger(to) ? to : null,
              at: new Date(now()).toISOString(),
            },
            { onConflict: 'user_id,note_id,actor_id' }
          )
          .select(COLUMNS)
          .single(),
        'announce'
      );

      return toEntry(written);
    },

    /** Live entries for a note, newest heartbeat first. */
    async list(userId, noteId) {
      const data = unwrap(
        await client
          .from(PRESENCE_TABLE)
          .select(COLUMNS)
          .eq('user_id', userId)
          .eq('note_id', noteId)
          .gte('at', cutoff())
          .order('at', { ascending: false }),
        'list'
      );
      return (Array.isArray(data) ? data : []).map(toEntry);
    },

    /** An agent leaving politely. Nothing depends on it; the TTL does the work. */
    async leave({ userId, noteId, actorId }) {
      const data = unwrap(
        await client
          .from(PRESENCE_TABLE)
          .delete()
          .eq('user_id', userId)
          .eq('note_id', noteId)
          .eq('actor_id', String(actorId))
          .select('actor_id'),
        'leave'
      );
      return (Array.isArray(data) ? data : []).length > 0;
    },
  };
}
