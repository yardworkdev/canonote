# API Contracts

This document describes the current server API contracts in this repo.

It is intended as a working reference for implementation and debugging, not a public product spec.

Entrypoints:

- [api/notes.js](./api/notes.js)
- [api/agent.js](./api/agent.js)


Implementation:

- [api/\_lib/notes-handler.js](./api/_lib/notes-handler.js)
- [api/\_lib/agent-handler.js](./api/_lib/agent-handler.js)

- [api/\_lib/authz.js](./api/_lib/authz.js)

## Authentication

There are two distinct auth models depending on which API is being called.

### Notes API auth (`/api/notes`)

- Accepts only `Authorization: Bearer <supabase-jwt>`
- Rejects non-user actors (agents cannot use `/api/notes`)
- No scope system — user identity is sufficient

### Agent API auth (`/api/agent`)

Accepted token locations (first match wins):

- `Authorization: Bearer <token>`
- `x-agent-token: <token>`

Headers only — a `?token=` in the query string is ignored (a URL is logged, shared and cached, so a
credential that rides in one is published), and the request is answered as unauthenticated.

Actor resolution order:

1. env-configured agent token
2. delegated connection token (hash-verified against `agent_connections` table)
3. Supabase user JWT

Default available scopes for all authenticated actors:

- `notes:read`
- `notes:write`

---

## Notes API

Base path: `/api/notes`

Auth: Supabase user JWT only. Agents cannot call these routes.

Implementation: [api/\_lib/notes-handler.js](./api/_lib/notes-handler.js)

### `GET /api/notes`

Purpose:

- list all notes for the authenticated user, ordered by `updated_at` descending

Query params:

- `q` — optional search string; if provided, searches title and content and returns snippets

Success:

- `200`

Response shape:

```json
{
  "success": true,
  "data": [
    {
      "id": "note-123",
      "note_id": "note-123",
      "title": "Draft",
      "updated": 1700000000000,
      "updated_at": "2026-03-08T10:00:00.000Z",
      "isPinned": false,
      "folder": "private",
      "revision": "4"
    }
  ]
}
```

Notes:

- list response does not include `content`; fetch by ID to get content
- `revision` is the note's `version` as a string (the column migration 010 added, bumped by a trigger on
  every write) — the value to send back as `ifRevision` on a write, not a content hash

### `GET /api/notes/:noteId`

Purpose:

- fetch one note with full content

Success:

- `200`

Headers:

- `ETag: "<revision>"`

Response includes `content` field.

Errors:

- `404` note not found

### `POST /api/notes`

Purpose:

- create a note

Request:

```json
{
  "noteId": "note-abc123",
  "title": "My note",
  "content": "Hello",
  "folder": "private",
  "isPinned": false
}
```

Notes:

- `noteId` is provided by the client (generated as `` `note-${Date.now()}` `` in the UI)
- `title` falls back to first line of `content` if omitted

Success:

- `201`

Headers:

- `ETag: "<revision>"`

### `PATCH /api/notes/:noteId`

Purpose:

- update note title, content, pin state, or the per-note agent switch. Not `folder`: a person has no
  control that sets it, so accepting it here would be a write nothing can explain

Request:

```json
{
  "title": "Updated title",
  "content": "Updated body",
  "isPinned": true,
  "ifRevision": "<revision>"
}
```

Alternative conflict control:

- `If-Match: "<revision>"`

All fields are optional — only provided fields are updated.

Success:

- `200`

Headers:

- `ETag: "<revision>"`

Errors:

- `404` note not found
- `409` revision conflict
- `428` revision required but not provided

Conflict response shape:

```json
{
  "success": false,
  "error": "Revision conflict. Refresh and retry with the latest revision.",
  "data": { "id": "note-123", "revision": "<current>" },
  "currentRevision": "<current>"
}
```

### `DELETE /api/notes/:noteId`

Purpose:

- soft-delete a note (sets `deleted_at`)

Request:

```json
{
  "ifRevision": "<revision>"
}
```

Success:

- `200`

Errors:

- `404` note not found (treated as success by the client)
- `409` revision conflict
- `428` revision required but not provided

---

## Agent API

Base path:

- `/api/agent`

Task-shaped quickstart with copy-paste examples for these routes: [AGENT_API.md](./AGENT_API.md).
This section is the exhaustive reference for their shapes.

### `GET /api/agent`

Purpose:

- health/info endpoint for the authenticated actor

Auth:

- any valid authenticated actor

Success:

- `200`

Response shape:

```json
{
  "success": true,
  "data": {
    "agent": "Agent",
    "authType": "agent",
    "userId": "user-123",
    "scopes": ["notes:read", "notes:write"],
    "expiresAt": null,
    "version": "x.y.z",
    "routes": ["GET /api/agent/notes"]
  }
}
```

### `GET /api/agent/connections`

Purpose:

- list delegated connections for the current human user

Auth:

- authenticated human user only

Success:

- `200`

Errors:

- `401` missing/invalid auth
- `403` actor is not a human user

Response item shape:

```json
{
  "id": "connection-id",
  "userId": "user-123",
  "agentId": "agent",
  "agentLabel": "Agent",
  "scopes": ["notes:read", "notes:write"],
  "isActive": true,
  "tokenPrefix": "agent_abcd123",
  "lastUsedAt": "2026-03-08T10:00:00.000Z",
  "expiresAt": "2026-04-07T10:00:00.000Z",
  "createdAt": "2026-03-08T10:00:00.000Z",
  "updatedAt": "2026-03-08T10:00:00.000Z"
}
```

### `POST /api/agent/connections`

Purpose:

- create a delegated token for external agent use

Auth:

- authenticated human user only

Request:

```json
{
  "agentLabel": "Agent",
  "scopes": ["notes:read", "notes:write"],
  "expiresAt": "2026-04-07T10:00:00.000Z"
}
```

Success:

- `201`

Response:

- sanitized connection fields
- plus plaintext `token`

Important:

- plaintext token is returned once
- the server stores only a token hash

Errors:

- `401` missing/invalid auth
- `403` actor is not a human user
- `400` invalid scopes, an expiry in the past, or an expiry beyond the maximum lifetime
- `429` the user's active-connection limit is reached

### `DELETE /api/agent/connections/:connectionId`

Purpose:

- revoke one delegated connection

Auth:

- authenticated human user only

Success:

- `200`

Errors:

- `401` missing/invalid auth
- `403` actor is not a human user
- `400` missing connectionId
- `404` no such connection for this user

### `DELETE /api/agent/connections`

Purpose:

- revoke all active delegated connections for the current user

Auth:

- authenticated human user only

Success:

- `200`

### `GET /api/agent/stats`

Purpose:

- aggregate user/note stats

Auth:

- any actor with `notes:read`

Success:

- `200`

Response shape:

```json
{
  "success": true,
  "data": {
    "generatedAt": "2026-03-08T10:00:00.000Z",
    "totals": {
      "users": 10,
      "activeUsers30d": 7,
      "notes": 120
    }
  }
}
```

Notes:

- the response carries totals only: no per-user rows and no email addresses (the user list the handler
  aggregates over is deliberately not returned)

### `GET /api/agent/audit`

Purpose:

- the trail of agent note mutations, newest first

Auth:

- any actor with `notes:read`, attached to a user

Query:

- `limit` (default 100, max 200)

Success:

- `200`

Response shape:

```json
{
  "success": true,
  "data": [
    {
      "eventId": "0f6c1e2a-3b7d-4a1e-9c2f-51a2b3c4d5e6",
      "noteId": "note-1730000000000-ab12cd",
      "actorId": "agent_rudi",
      "actorType": "agent",
      "action": "notes.update",
      "beforeHash": "b6d2c1…",
      "afterHash": "9a41f7…",
      "metadata": { "noteId": "note-1730000000000-ab12cd", "title": "Weekly review" },
      "createdAt": "2026-10-16T09:00:00.000Z"
    }
  ],
  "pageInfo": { "limit": 100, "returned": 1, "hasMore": false }
}
```

Notes:

- the read is scoped by the owner of the notes (`agent_audit_log.user_id`, migration 014), never by the
  actor, so a delegated key and the user who issued it read the same events
- a token with no owner answers `403`; a store that refuses the read answers `500`, so "no events" is
  never stated as "the read failed" or the other way round
- `action` is `notes.create` or `notes.update`; `beforeHash` is null for a create
- there is no route that deletes an event

### `GET /api/agent/notes`

Purpose:

- paginated canonical note listing

Auth:

- actor with `notes:read`

Query params:

- `limit`
  - default `200`
  - max `500`
- `cursor`
  - opaque base64url cursor from previous page

Success:

- `200`

Response:

```json
{
  "success": true,
  "data": [
    {
      "note_id": "note-123",
      "title": "Draft",
      "content": "Body",
      "updated_at": "2026-03-08T10:00:00.000Z",
      "revision": "4"
    }
  ],
  "pageInfo": {
    "hasMore": false,
    "nextCursor": null,
    "limit": 200
  }
}
```

Notes:

- single items are returned in `data`
- pagination metadata is returned at top-level `pageInfo`
- `revision` is the note's `version` as a string — the value to send back as `ifRevision`, not a hash
- the rows also carry the notebook's internal columns (`user_id`, `version`, `deleted_at`); ignore them
- the list does **not** carry `content`: each item has `contentBytes` instead, the length of the
  body in bytes, so an agent can see which note is worth a second call without paying for the text.
  Fetch the body with `GET /api/agent/notes/:noteId` — that route is how a body is read.
- an agent's own notes are stamped `folder: "agent"` (migration `016`); the label is stored but
  shown nowhere, authorship is what the notebook displays

### `GET /api/agent/notes/:noteId`

Purpose:

- fetch one canonical note

Auth:

- actor with `notes:read`

Success:

- `200`

Headers:

- `ETag: "<revision>"`

Errors:

- `400` missing noteId
- `404` note not found

### `POST /api/agent/notes`

Purpose:

- create a canonical note

Auth:

- actor with `notes:write`

Request:

```json
{
  "title": "My note",
  "content": "Hello",
  "folder": "agent"
}
```

Optional request field:

- `userId`
  - must match authenticated `userId` if provided

Success:

- `201`

Headers:

- `ETag: "<revision>"`

Errors:

- `403` mismatched body `userId`

### `PATCH /api/agent/notes/:noteId`

Purpose:

- update canonical note title/content

Auth:

- actor with `notes:write`

Request:

```json
{
  "title": "Updated title",
  "content": "Updated body",
  "ifRevision": "<revision>"
}
```

Alternative conflict control:

- `If-Match: "<revision>"`

Success:

- `200`

Headers:

- `ETag: "<revision>"`

Errors:

- `400` missing noteId
- `404` note not found
- `409` revision conflict
- `428` revision required but not provided (read the note, then retry with `ifRevision` or `If-Match`)

Conflict response shape:

```json
{
  "success": false,
  "error": "Revision conflict. Refresh and retry with the latest revision.",
  "data": {
    "note_id": "note-123",
    "revision": "<current>"
  },
  "currentRevision": "<current>"
}
```

## The thread on a note

`note_messages` (migration `021`) is a conversation attached to a note: the place a person and
their agents talk, and the place an agent offers a change instead of making one.

It replaced the old comment/suggestion overlay (`/api/collaboration/*`), which is gone. The
difference that matters: an overlay was a second surface with its own state, whereas a thread is a
record of who asked for what and what was decided — and a proposal reaches the note only when a
person applies it, through the editor's own guarded save.

Presence is not this. Presence is a heartbeat in one row per (note, actor) that expires in twelve
seconds and is filtered on read; a message is a row that survives a redeploy. The heartbeat is in
Postgres (`note_presence`) so that every function and every warm instance answers the same question —
it used to be one process's memory, and a caret announced through one route was invisible through
the other in the same second.

### `GET /api/notes/:noteId/messages`

The person's read. Query: `since` (ISO 8601, optional poll cursor).

```json
{ "success": true, "data": [ <message> ], "pageInfo": { "since": "<newest createdAt>" } }
```

At most 50 messages per answer, oldest first. `pageInfo.since` is the cursor for the next poll; a
poll with nothing new returns `[]` and an unchanged cursor.

`since` scans two columns, not one: a message written after the cursor **and** a message decided
after it. A proposal applied in one tab is an old row with a new `decidedAt`, so a cursor that only
looked at `createdAt` left the other tab offering Apply on something already handled. The returned
cursor is the newest of `createdAt` and `decidedAt`, so a decision does not drag it backwards and the
same row is not re-read every five seconds.

### `POST /api/notes/:noteId/messages`

The person's write. Body: `{ body, kind?, baseRevision? }`. `kind` is `note` or `proposal`;
`baseRevision` is required for a proposal and forbidden otherwise.

```json
{ "success": true, "data": <message> }
```

### `POST /api/notes/:noteId/messages/:messageId`

The person's decision. Body: `{ applied: boolean }`. Only a proposal can be decided; anything else
is `404`. Applying records the decision — the text still has to win its revision through
`PATCH /api/notes/:noteId`.

```json
{ "success": true, "data": <message with appliedAt and decidedAt> }
```

### `GET /api/agent/notes/:noteId/messages`

The agent's read. Same shape and cursor as the person's route. Scope `notes:read`.

### `POST /api/agent/notes/:noteId/messages`

The agent's write. Body: `{ body, kind?, baseRevision? }`. Scope `notes:read` — speaking is not
writing to the note. A proposal without `baseRevision` is a `400` naming the field; a body over
2000 bytes is a `400`.

```json
{ "success": true, "data": <message> }
```

**An agent has no route that decides.** `POST /api/agent/notes/:noteId/messages/:messageId` is not
handled and answers `404`, so the agent cannot approve its own proposal. Deciding is the person's
route above.

### The message shape

```json
{
  "id": "<uuid>",
  "noteId": "note-123",
  "authorType": "human" | "agent",
  "authorName": "Promi",
  "kind": "note" | "proposal" | "decision",
  "body": "…",
  "baseRevision": 204,
  "createdAt": "<ISO>",
  "appliedAt": null,
  "decidedAt": null
}
```

Both routes are governed by the note's agent switch: a note switched off answers `404` here too,
exactly as it does on every other agent route.

## Presence

Where everyone is working on one note. A caret, a name and a mode; nothing is stored in a note and
nothing survives twelve seconds.

### `GET /api/notes/:noteId/presence` — the person's poll

```json
{ "success": true, "data": { "ttl": 12000, "revision": "204", "entries": [ <entry> ] } }
```

The revision rides along so an open editor learns an agent's write moved the text without a second
request. The person's own caret is never in `entries`: they know where they are typing, and a second
mark of themselves reads as a stranger.

Errors:

- `400` malformed note id
- `404` note not found, deleted, or switched off for agents

The `404` is the same answer the agent route gives, and it is the point: a missing note and a live
note with nobody in it must not look alike. This route used to answer `200` with `revision: null`
for a note that never existed, and kept reporting the last revision of a deleted one.

### `GET /api/agent/notes/:noteId/presence` and `POST /api/agent/notes/:noteId/presence`

The agent's read and heartbeat, same shape, same `404` rule. `POST` body:

```json
{ "mode": "reading" | "proposing" | "writing", "from": 117, "to": 117 }
```

The same `POST` carries the person's own caret with a session token: `from` is required, `mode` is
refused (a person has a caret, not a mode).

Heartbeat 4 s, expiry 12 s, eight actors per note, one row per (note, actor) in `note_presence`, so
every function and every warm instance answers the same question.



## Common Error Cases

- `401 Unauthorized`
  - missing auth
  - invalid token
  - expired token
- `403 Forbidden`
  - missing required scope
  - human-only connection management called by non-user actor
- `404 Not found`
  - note/comment/suggestion missing
- `409 Conflict`
  - stale note revision during note or suggestion update

## Related Docs

- [AI_COLLABORATION_ARCHITECTURE.md](./AI_COLLABORATION_ARCHITECTURE.md)
- [SUPABASE_SETUP.md](./SUPABASE_SETUP.md)

---

Last updated: 2026-06-03
