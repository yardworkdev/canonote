/**
 * Presence, as a value.
 *
 * Who is in this note right now, where their caret is, and what an agent is doing
 * to it. Everything here is pure so it can be tested without a browser: the
 * transport lives in usePresence, and the server-side TTL store lives in
 * api/_lib/presence.js.
 *
 * Two rules keep this cheap and honest:
 *   - a message is a heartbeat, not a document: 160 bytes at most
 *   - presence expires. A closed tab is gone in twelve seconds, without a goodbye
 */

/** Nobody sends more than this per second, however fast they type. */
export const PRESENCE_MAX_PER_SECOND = 10;

/** How often a live participant repeats itself. */
export const PRESENCE_HEARTBEAT_MS = 4000;

/** A participant nobody has heard from for this long is gone. */
export const PRESENCE_TTL_MS = 12000;

/** Modes an agent can be in. A person only ever has a caret. */
export const AGENT_MODES = ['reading', 'proposing', 'writing'];

export const MAX_NAME = 24;
export const MAX_MESSAGE_BYTES = 160;

const isOffset = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 10_000_000;

const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Build the payload that goes on the wire.
 * An invalid message throws here rather than reaching a renderer that would have
 * to guess what half a caret means.
 */
export function encodePresence(input = {}) {
  const kind = input.kind === 'agent' ? 'agent' : 'human';
  const name = clip(input.name, MAX_NAME) || (kind === 'agent' ? 'Agent' : 'Someone');
  const payload = {
    v: 1,
    k: kind,
    id: clip(input.id, 40) || `${kind}-unknown`,
    n: name,
    at: Number.isFinite(input.at) ? input.at : Date.now(),
  };

  if (isOffset(input.from)) payload.f = input.from;
  if (isOffset(input.to)) payload.t = input.to;
  if (kind === 'agent') payload.m = AGENT_MODES.includes(input.mode) ? input.mode : 'reading';
  if (input.away === true) payload.a = 1;
  if (input.noteId) payload.x = clip(input.noteId, 64);

  const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  if (bytes > MAX_MESSAGE_BYTES) {
    throw new Error(`presence message is ${bytes} bytes, over the ${MAX_MESSAGE_BYTES} byte budget`);
  }
  return payload;
}

/** Parse what came off the wire. Anything unreadable is null, never a throw. */
export function decodePresence(raw) {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || value.v !== 1) return null;
  const kind = value.k === 'agent' ? 'agent' : value.k === 'human' ? 'human' : null;
  if (!kind || typeof value.id !== 'string' || !value.id) return null;
  if (!Number.isFinite(value.at)) return null;
  return {
    kind,
    id: value.id,
    name: typeof value.n === 'string' && value.n ? value.n : kind === 'agent' ? 'Agent' : 'Someone',
    at: value.at,
    from: isOffset(value.f) ? value.f : null,
    to: isOffset(value.t) ? value.t : null,
    mode: kind === 'agent' && AGENT_MODES.includes(value.m) ? value.m : null,
    away: value.a === 1,
    noteId: typeof value.x === 'string' ? value.x : null,
  };
}

/**
 * A message that is already older than the TTL when it lands is not presence, it
 * is a memory: a queued message from a tab that closed. Dropped.
 */
export function isFresh(entry, now = Date.now(), ttl = PRESENCE_TTL_MS) {
  return Boolean(entry) && Number.isFinite(entry.at) && now - entry.at <= ttl;
}

/** Drop anything stale, and never show the same person twice. */
export function livePresence(entries, { now = Date.now(), selfId = null } = {}) {
  const byId = new Map();
  for (const entry of entries || []) {
    if (!isFresh(entry, now)) continue;
    if (selfId && entry.id === selfId) continue;
    const previous = byId.get(entry.id);
    if (!previous || previous.at <= entry.at) byId.set(entry.id, entry);
  }
  return [...byId.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'human' ? -1 : 1;
    return b.at - a.at;
  });
}

/** "Rudi · reading", "Ves", "Rudi · away". */
export function describePresence(entry) {
  if (!entry) return '';
  if (entry.kind === 'human') return entry.name;
  if (entry.away) return `${entry.name} · away`;
  return `${entry.name} · ${entry.mode || 'reading'}`;
}

/**
 * At most PRESENCE_MAX_PER_SECOND, and always the latest position.
 * The throttle keeps the last value rather than the first: when someone types
 * fast, what other people need to see is where the caret ended up.
 */
export function createThrottle({ limit = PRESENCE_MAX_PER_SECOND, now = () => Date.now() } = {}) {
  const windowMs = 1000;
  let sent = 0;
  let windowStart = now();
  let pending = null;
  let timer = null;

  const flush = (send) => {
    timer = null;
    if (pending === null) return;
    const value = pending;
    pending = null;
    sent += 1;
    send(value);
  };

  return {
    push(value, send) {
      const current = now();
      if (current - windowStart >= windowMs) {
        windowStart = current;
        sent = 0;
      }
      if (sent < limit) {
        sent += 1;
        send(value);
        return;
      }
      pending = value;
      if (!timer) {
        const wait = Math.max(0, windowMs - (current - windowStart));
        timer = setTimeout(() => flush(send), wait);
      }
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
