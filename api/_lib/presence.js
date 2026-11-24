/**
 * Server-side presence: where an agent is working, for twelve seconds.
 *
 * This is the in-memory implementation, and it is the fallback, not the product:
 * a caret stored here is visible only to requests that land in this process. It
 * was the only store until 2026-11-19, and on production a caret announced through
 * the agent route was already invisible through the notes route in the same
 * second. `presence-shared.js` now answers from Postgres when the deployment has a
 * database, and falls back to this store when it does not — or when the database
 * refuses, because a caret is never worth a failed request.
 *
 * Either way nothing here is authoritative: every entry carries its own timestamp
 * and is filtered on read, so a stale caret is never shown as a live one. The
 * note, its revision and its access flag are in Postgres; a caret is a heartbeat.
 */

export const PRESENCE_TTL_MS = 12_000;

/** At most this many agents per note. A pattern of abuse is capped, not logged. */
export const MAX_ENTRIES_PER_NOTE = 8;

/** Modes an agent can announce. Anything else is `reading`. */
export const AGENT_MODES = ['reading', 'proposing', 'writing'];

/** The one entry a person can have in a note: their caret. Keyed, so it never multiplies. */
export const PERSON_ACTOR_ID = 'person';

/**
 * @param {{ ttl?: number, now?: () => number }} [options]
 */
export function createPresenceStore({ ttl = PRESENCE_TTL_MS, now = () => Date.now() } = {}) {
  /** @type {Map<string, Map<string, any>>} */
  const notes = new Map();

  const keyOf = (userId, noteId) => `${userId}:${noteId}`;

  return {
    /**
     * Record one heartbeat. Returns the entry as it will be read back, so a caller
     * can echo the effective mode rather than the one it asked for.
     *
     * `kind` is 'agent' by default. A person announces the same way and their
     * caret is stored beside the agents' — an agent cannot join a browser
     * channel, so if the person's caret never leaves the browser, no agent can
     * see where they are typing.
     */
    announce({ userId, noteId, actorId, actorName, kind = 'agent', mode, from, to }) {
      const entryKind = kind === 'person' ? 'person' : 'agent';
      const key = keyOf(userId, noteId);
      let here = notes.get(key);
      if (!here) {
        here = new Map();
        notes.set(key, here);
      }
      if (!here.has(actorId) && here.size >= MAX_ENTRIES_PER_NOTE) {
        const oldest = [...here.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) here.delete(oldest[0]);
      }
      const entry = {
        kind: entryKind,
        id: String(actorId || (entryKind === 'person' ? PERSON_ACTOR_ID : 'agent')),
        name: String(actorName || 'Agent').slice(0, 24),
        from: Number.isInteger(from) ? from : null,
        to: Number.isInteger(to) ? to : null,
        at: now(),
      };
      // A person has a caret, never a mode. Saying "reading" about someone who is
      // typing would be an invented fact in the agent's context.
      if (entryKind === 'agent') entry.mode = AGENT_MODES.includes(mode) ? mode : 'reading';
      here.set(entry.id, entry);
      return entry;
    },

    /** Live entries for a note, oldest heartbeats dropped, newest first. */
    list(userId, noteId) {
      const here = notes.get(keyOf(userId, noteId));
      if (!here) return [];
      const cutoff = now() - ttl;
      // Exactly at the TTL still counts as live, matching isFresh on the client.
      for (const [id, entry] of here) if (entry.at < cutoff) here.delete(id);
      if (here.size === 0) notes.delete(keyOf(userId, noteId));
      return [...here.values()].sort((a, b) => b.at - a.at);
    },

    /** An agent leaving politely. Nothing depends on it; the TTL does the work. */
    leave({ userId, noteId, actorId }) {
      const key = keyOf(userId, noteId);
      const here = notes.get(key);
      if (!here) return false;
      const removed = here.delete(String(actorId));
      if (here.size === 0) notes.delete(key);
      return removed;
    },

    /** For tests and for the stats route: how many notes have live presence. */
    size() {
      return notes.size;
    },

    clear() {
      notes.clear();
    },
  };
}

/** One store per server instance. */
export const presenceStore = createPresenceStore();
