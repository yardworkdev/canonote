/**
 * The presence API both functions call: Postgres when it is configured, this
 * instance's memory when it is not, and memory again if the database refuses.
 *
 * Presence is a courtesy. A note must open and save whether or not a caret can be
 * placed, so a failing presence write is never allowed to fail the request — it
 * degrades to the old per-instance behaviour, which is wrong in the way it always
 * was wrong and never wrong in a new way.
 *
 * Every method is async because one of the two backends is. The in-memory store
 * is synchronous, which a caller does not have to know.
 */

import { createPresenceRepository } from './presence-repository.js';
import { presenceStore } from './presence.js';

/**
 * @param {{ client?: any, memory?: any, onFallback?: (op: string, error: Error) => void }} [options]
 */
export function createSharedPresence({ client = null, memory = presenceStore, onFallback = null } = {}) {
  const repository = client ? createPresenceRepository(client) : null;

  const withFallback = async (op, call) => {
    if (!repository) return call(memory);
    try {
      return await call(repository);
    } catch (error) {
      // Never the caller's problem: a caret that cannot be stored is a caret the
      // browser will send again in four seconds.
      if (onFallback) onFallback(op, error);
      return call(memory);
    }
  };

  return {
    /** True when presence is shared by every instance (Postgres), not per lambda. */
    shared: Boolean(repository),

    announce: (args) => withFallback('announce', (store) => store.announce(args)),
    list: (userId, noteId) => withFallback('list', (store) => store.list(userId, noteId)),
    leave: (args) => withFallback('leave', (store) => store.leave(args)),
  };
}
