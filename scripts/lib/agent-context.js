import crypto from 'node:crypto';

/**
 * The context economy of the agent API.
 *
 * An agent should be able to enter this notebook, find one note, and leave —
 * without the notebook ever entering its context window. That is not a matter of
 * documentation; it is enforced here, in what every response is allowed to be.
 *
 * Laws:
 *   1. Entry is a manifest, ≤ 700 bytes, and contains no note content.
 *   2. A list returns metadata only. Bodies are opt-in, one note at a time.
 *   3. Every response is byte-capped; truncation is explicit, never silent.
 *   4. `fields` is always honoured — an agent pays for what it asks for.
 *   5. `since` makes the second visit cheaper than the first.
 *   6. No endpoint returns every body. Ever.
 */

export const MANIFEST_MAX_BYTES = 700;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
export const DEFAULT_MAX_BYTES = 8000;
export const HARD_MAX_BYTES = 16000;

export const NOTE_FIELDS = ['id', 'title', 'created', 'updated', 'words', 'rev', 'folder', 'tags'];

/** Truncate a UTF-8 string to a byte budget without splitting a character. */
export function clampToBytes(text, maxBytes) {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return { text, truncated: false, bytes: buf.length };
  const cut = buf.subarray(0, Math.max(0, maxBytes)).toString('utf8').replace(/\uFFFD$/, '');
  return { text: cut, truncated: true, bytes: Buffer.byteLength(cut, 'utf8') };
}

/**
 * Serialise, then hold the whole body inside the caller's budget.
 *
 * A truncated response is still valid JSON: an agent that receives one can parse
 * it, see `truncated: true`, read the head, and narrow the request. Cutting a
 * document mid-string would hand back something no client can use.
 */
export function respond(payload, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const budget = Math.min(Number(maxBytes) || DEFAULT_MAX_BYTES, HARD_MAX_BYTES);
  const raw = JSON.stringify(payload);
  const rawBytes = Buffer.byteLength(raw, 'utf8');
  if (rawBytes <= budget) return { body: raw, bytes: rawBytes, truncated: false };

  let headBudget = Math.max(0, budget - 200);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const head = clampToBytes(raw, headBudget).text;
    const body = JSON.stringify({
      truncated: true,
      budget,
      head,
      hint: 'narrow it: fields=id,title  limit=5  part=meta|body  maxBytes=',
    });
    const bytes = Buffer.byteLength(body, 'utf8');
    if (bytes <= budget) return { body, bytes, truncated: true };
    headBudget = Math.max(0, headBudget - 120);
  }

  const fallback = JSON.stringify({ truncated: true, budget, hint: 'request too large; ask for less' });
  return { body: fallback, bytes: Buffer.byteLength(fallback, 'utf8'), truncated: true };
}

/** Project rows down to the requested fields, in the requested order. */
export function project(row, fields) {
  if (!fields || !fields.length) return pick(row, NOTE_FIELDS);
  const out = {};
  for (const f of fields) if (f in row) out[f] = row[f];
  return out;
}

function pick(row, keys) {
  const out = {};
  for (const k of keys) if (row[k] !== undefined) out[k] = row[k];
  return out;
}

export function parseFields(value) {
  if (!value) return null;
  const asked = String(value)
    .split(',')
    .map((f) => f.trim())
    .filter((f) => NOTE_FIELDS.includes(f));
  return asked.length ? asked : null;
}

export function parseLimit(value, fallback = DEFAULT_LIMIT, max = MAX_LIMIT) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

/** Opaque, stable cursor: updatedAt + id. No offsets, so writes never skip a row. */
export function encodeCursor(row) {
  return Buffer.from(`${row.updated}|${row.id}`).toString('base64url');
}

export function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const [updated, id] = Buffer.from(String(cursor), 'base64url').toString('utf8').split('|');
    if (!updated || !id) return null;
    return { updated, id };
  } catch {
    return null;
  }
}

export function afterCursor(rows, cursor) {
  const c = decodeCursor(cursor);
  if (!c) return rows;
  return rows.filter((r) => r.updated < c.updated || (r.updated === c.updated && r.id < c.id));
}

/** Incremental read: only what changed since the agent last looked. */
export function since(rows, iso) {
  if (!iso) return rows;
  return rows.filter((r) => r.updated > iso);
}

export function page(rows, { limit, fields }) {
  const sliced = rows.slice(0, limit);
  const items = sliced.map((r) => project(r, fields));
  const last = sliced[sliced.length - 1];
  const next = rows.length > sliced.length && last ? encodeCursor(last) : null;
  return { items, next };
}

/**
 * The handshake. One GET, under 700 bytes, that tells an agent everything it
 * needs to work without reading anything it does not need.
 */
export function manifest({ counts, newest, base }) {
  return {
    canonote: 1,
    you: 'a key with read + propose rights',
    notes: counts.total,
    pending: counts.pending,
    newest,
    start: `${base}/api/agent/notes?limit=20&fields=id,title,updated,words`,
    then: [
      `${base}/api/agent/notes/:id?part=meta|body`,
      `${base}/api/agent/search?q=`,
      `PATCH ${base}/api/agent/notes/:id?part=body  (if-rev header)`,
    ],
    rules: ['lists are metadata only', 'bodies one at a time', 'every response is capped'],
    limits: { maxBytes: DEFAULT_MAX_BYTES, maxNotes: MAX_LIMIT },
    off: `${base}/api/agent/switch`,
  };
}

/** Keys are shown once and stored hashed: nothing to steal from a database dump. */
export function mintKey(prefix = 'cn_live') {
  const id = crypto.randomBytes(4).toString('hex');
  const secret = crypto.randomBytes(24).toString('base64url');
  const key = `${prefix}_${id}_${secret}`;
  return { id, key, hash: hashKey(key) };
}

export function hashKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

export function timingSafeEqualHex(a, b) {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  if (x.length !== y.length || x.length === 0) return false;
  return crypto.timingSafeEqual(x, y);
}
