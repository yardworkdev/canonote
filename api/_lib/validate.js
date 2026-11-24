/**
 * Request bodies are validated before they touch a handler.
 *
 * Every write route used to read `req.body || {}` and trust it, which meant a
 * client bug (a number where a string belonged, an object where markdown
 * belonged) reached the database as a silent bad write: `content: {}` becomes
 * "[object Object]" in the note and nobody sees a failure. The schemas below are
 * the contract the API already documents, enforced.
 *
 * Shapes are deliberately permissive about extra keys and strict about types:
 * an unknown extra key is dropped, a wrong type is a 400 naming the field.
 */

import * as v from 'valibot';

/** A note body can be large, but not unbounded: Vercel caps the request at ~4.5 MB. */
const MAX_CONTENT_BYTES = 2 * 1024 * 1024;
const MAX_TITLE = 300;
const MAX_FOLDER = 60;
const MAX_LABEL = 80;

const text = (max) =>
  v.pipe(v.string(), v.maxLength(max, `Must be at most ${max} characters.`));

const content = v.pipe(
  v.string('Content must be a string of markdown.'),
  v.check(
    (value) => Buffer.byteLength(value, 'utf8') <= MAX_CONTENT_BYTES,
    'Content is larger than 2 MB.'
  )
);

const revision = v.pipe(v.string(), v.maxLength(128));

/** POST /api/agent/notes */
export const agentCreateNote = v.object({
  title: v.optional(text(MAX_TITLE)),
  content: v.optional(content),
  userId: v.optional(v.string()),
  folder: v.optional(text(MAX_FOLDER)),
});

/** PATCH /api/agent/notes/:id — a revision is optional here; the handler decides. */
export const agentUpdateNote = v.object({
  title: v.optional(text(MAX_TITLE)),
  content: v.optional(content),
  ifRevision: v.optional(v.nullable(revision)),
});

/** POST /api/agent/connections */
export const agentConnection = v.object({
  agentLabel: v.optional(v.nullable(text(MAX_LABEL))),
  scopes: v.optional(v.array(v.string())),
  expiresAt: v.optional(v.nullable(v.string())),
});

/** POST /api/notes — the browser's create route. */
export const noteCreate = v.object({
  noteId: v.optional(v.string()),
  title: v.optional(text(MAX_TITLE)),
  content: v.optional(content),
});

/** PATCH /api/notes/:id — including the per-note agent switch. */
export const noteUpdate = v.object({
  title: v.optional(text(MAX_TITLE)),
  content: v.optional(content),
  isPinned: v.optional(v.boolean('isPinned must be true or false.')),
  agentAccess: v.optional(v.boolean('agentAccess must be true or false.')),
  ifRevision: v.optional(v.nullable(revision)),
});

/** POST /api/notes/:id/revert */
export const noteRevert = v.object({
  // `note_versions.revision` is a bigint in production and was a string in the
  // tests, so a restore failed on the live database with "revision has to be
  // text". Both are accepted: the column decides, not the shape of the request.
  revision: v.union([
    v.pipe(v.string('revision has to be text.'), v.minLength(1), v.maxLength(200)),
    v.pipe(v.number(), v.integer()),
  ]),
});

/** POST /api/agent/notes/:id/presence */
export const agentPresence = v.object({
  mode: v.optional(v.picklist(['reading', 'proposing', 'writing'])),
  from: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  to: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
});

/**
 * POST /api/agent/notes/:id/presence — the person's own caret.
 *
 * `from` is required: "I am here" without a position is not something an agent
 * can act on, and the store would otherwise keep an entry nobody can place.
 */
export const personPresence = v.object({
  from: v.pipe(v.number(), v.integer(), v.minValue(0)),
  to: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
});

/**
 * POST /api/agent/notes/:id/messages and POST /api/notes/:id/messages
 *
 * `body` is capped by byte count inside the thread store, not here: a character
 * limit and a byte limit are different promises, and the poller pays bytes.
 */
export const noteMessage = v.object({
  body: v.pipe(v.string(), v.minLength(1)),
  kind: v.optional(v.picklist(['note', 'proposal'])),
  baseRevision: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
});

/** POST /api/notes/:id/messages/:messageId — the person's answer to a proposal. */
export const noteMessageDecision = v.object({
  applied: v.pipe(v.boolean()),
});

/**
 * Validate a body against a schema.
 * Returns the parsed value, or a 400-shaped result the route can return as-is.
 */
export function check(schema, body) {
  const result = v.safeParse(schema, body ?? {});
  if (result.success) return { ok: true, value: result.output };
  const issue = result.issues?.[0];
  const field = issue?.path?.map((part) => part.key).filter(Boolean).join('.') || 'body';
  // A required key that never arrived is a missing field, not an invalid one: the
  // message a client prints should say what to add, not what it got wrong.
  const missing = issue?.type === 'object' && /undefined/.test(issue?.message || '');
  return {
    ok: false,
    status: 400,
    error: missing ? `Missing ${field}.` : `Invalid ${field}: ${issue?.message || 'request body is not valid.'}`,
    field,
  };
}

/**
 * Check the body of a write route, answering 400 itself when it is wrong.
 * Returns { ok: false } after responding, so the route can just return.
 */
export function guard(res, schema, body) {
  const result = check(schema, body);
  if (result.ok) return result;
  res.status(result.status).json({
    success: false,
    error: result.error,
    field: result.field,
    code: 'invalid_body',
  });
  return { ok: false };
}
