import { getUserSessionAuthHeaders } from '../utils/apiAuth';

/**
 * The notebook's own read of what the agent did.
 *
 * Slice 4's audit item, the client half: the trail is written on the server and
 * `GET /api/agent/audit` reads it, scoped to the owner. This module is the one
 * place the app asks, so the panel renders and never fetches.
 *
 * The trail is a server fact, so the notebook can only read it with a session.
 * In local mode — the shipped default — there is no account and no request is
 * made at all: the panel says so instead of showing an empty list, because "no
 * events" and "nothing to read from" are different facts and only one of them
 * is true. The decision about which sentence fits lives here, next to the
 * reason it was reached; the words come from the notice catalog
 * (`src/services/notices.js`), the same as every other message the app shows.
 */

/** How many events one read asks for. */
export const ACTIVITY_LIMIT = 50;

/** The route, in one place so the spec and the service cannot drift. */
export const ACTIVITY_PATH = '/api/agent/audit';

/** What the trail records, as the verb the reader sees. */
const ACTION_VERBS = {
  'notes.create': 'Created',
  'notes.update': 'Edited',
};

/**
 * One event as a sentence: the verb the trail records, and the note it hit.
 *
 * An action this build does not know is shown as it was recorded, never guessed
 * at — a wrong sentence about an edit is worse than a raw verb.
 */
export function activitySentence(event, noteTitle = null) {
  const verb = ACTION_VERBS[event?.action];
  if (verb) return noteTitle ? `${verb} “${noteTitle}”` : `${verb} a note`;
  if (event?.action) return noteTitle ? `${event.action} — “${noteTitle}”` : event.action;
  return noteTitle ? `Changed “${noteTitle}”` : 'Changed a note';
}

/** Who did it. The owner's own session is "you"; anything else is its own id. */
export function actorLabel(event) {
  if (event?.actorType === 'user') return 'you';
  return event?.actorId || 'an agent';
}

const unavailable = () => ({ ok: false, events: [], hasMore: false, notice: 'activityUnavailable' });

/**
 * Read the trail.
 *
 * `{ ok: true, events, hasMore }` when the server answered; otherwise
 * `{ ok: false, events: [], notice }` with the catalog key that fits: no
 * session, an ended session, or a server that did not answer.
 *
 * `headers` and `fetchImpl` are injectable so a unit test drives the whole
 * decision table without a network and without touching the Supabase client.
 */
export async function readAgentActivity({
  limit = ACTIVITY_LIMIT,
  headers = null,
  fetchImpl = null,
} = {}) {
  const request = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!request) return unavailable();

  const requestHeaders = headers || (await getUserSessionAuthHeaders());
  if (!requestHeaders?.Authorization) {
    return { ok: false, events: [], hasMore: false, notice: 'activityNoSession' };
  }

  let response;
  try {
    response = await request(`${ACTIVITY_PATH}?limit=${limit}`, { headers: requestHeaders });
  } catch {
    return unavailable();
  }

  // A session the server no longer accepts is not a broken server: it is an
  // ended session, and the reader is told to sign in rather than to retry.
  if (response?.status === 401 || response?.status === 403) {
    return { ok: false, events: [], hasMore: false, notice: 'activitySignedOut' };
  }
  if (!response?.ok) return unavailable();

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const events = Array.isArray(payload?.data) ? payload.data : [];
  return { ok: true, events, hasMore: Boolean(payload?.pageInfo?.hasMore), notice: null };
}
