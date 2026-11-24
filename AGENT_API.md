# The agent API

> **Context economy first.** Entering costs 564 bytes and no endpoint returns the notebook:
> see [AGENT_CONTEXT.md](./AGENT_CONTEXT.md) for the handshake, the byte caps, and the on/off
> switch that lets an agent work here without carrying your notes in its context window.

The notebook's whole point is that an agent can write into it. This is the API an agent calls: read
the notes, create one, edit one without clobbering an edit that happened while it was reading — with a
key the notebook's owner issued, scoped, and can revoke.

**It belongs to the optional hosted layer.** It needs a database: with no `SUPABASE_URL` +
`SUPABASE_SERVICE_KEY` every route answers `503` before it ever looks at your token
([SUPABASE_SETUP.md](./SUPABASE_SETUP.md)). The default local-first notebook does not run it, and the
deployed demo instance answers `503` until someone configures a database for it.

Every request and response shape is in [API_CONTRACTS.md](./API_CONTRACTS.md). This document is the
task-shaped half: get a key, call the API, handle the two failures that matter. Every example below is
executed against the real handler by `src/api/agent-api-docs.test.js`, so a change that makes one of
them wrong fails the unit gate.

```bash
BASE=https://your-deployment.example.com   # no trailing slash
TOKEN=agent_...                            # from step 1
```

## 1. Get a key

There are three ways to authenticate, in the order the server tries them:

1. **A delegated connection token** — `agent_<random>`, created by a signed-in user, carrying scopes
   and an expiry, revocable. This is the one to use.
2. **A Supabase user JWT** — a signed-in session token. The human's own full access, all four scopes.
3. **A static token from the environment** — `AGENT_API_TOKEN` / `AGENT_API_TOKENS`, a legacy
   fallback for a single-tenant deployment. It also needs `AGENT_OWNER_USER_ID`, because a static
   token has no user attached.

To issue a delegated key you need the user's session JWT (from the notebook's own sign-in), and the
notebook's **Collaboration** panel does the same call for you:

```bash
curl -sS -X POST "$BASE/api/agent/connections" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
        "agentLabel": "Claude Code",
        "scopes": ["notes:read", "notes:write"]
      }'
```

```json
{
  "success": true,
  "data": {
    "id": "8d3f...",
    "userId": "user-123",
    "agentId": "agent",
    "agentLabel": "Claude Code",
    "scopes": ["notes:read", "notes:write"],
    "isActive": true,
    "tokenPrefix": "agent_AbCdEf",
    "lastUsedAt": null,
    "expiresAt": null,
    "createdAt": "2026-10-16T09:00:00.000Z",
    "updatedAt": "2026-10-16T09:00:00.000Z",
    "token": "agent_AbCdEfGhIjKlMnOpQrStUvWxYz012345"
  }
}
```

**The `token` field is the only time the token exists in the clear.** The server stores its sha256 and
a 12-character prefix and nothing else, so a lost token is replaced, never recovered. Add
`"expiresAt": "<ISO 8601>"` to the body if the key should die on its own — it must be in the future and
no more than the maximum lifetime out (180 days by default), or the answer is `400`. Omit `scopes` and
you get all four.

Manage the keys as the same signed-in user:

```bash
curl -sS "$BASE/api/agent/connections" -H "Authorization: Bearer $USER_JWT"          # list (never a token, never a hash)
curl -sS -X DELETE "$BASE/api/agent/connections/8d3f..." -H "Authorization: Bearer $USER_JWT"   # revoke one
curl -sS -X DELETE "$BASE/api/agent/connections" -H "Authorization: Bearer $USER_JWT"           # revoke all
```

Revocation is immediate: the next request with that token is answered `401`.

## 2. Call it

Credentials go in a header and nowhere else — `?token=` is ignored and answered as unauthenticated,
because a URL ends up in access logs, proxy logs, `Referer` headers and browser history:

```bash
curl -sS "$BASE/api/agent" -H "Authorization: Bearer $TOKEN"
```

`x-agent-token: $TOKEN` works instead of the `Authorization` header. The first request to make is this
one — it tells the agent who it is, what it may do, and what routes exist:

```json
{
  "success": true,
  "data": {
    "agent": "Claude Code",
    "authType": "agent",
    "userId": "user-123",
    "scopes": ["notes:read", "notes:write"],
    "expiresAt": null,
    "version": "1.0.0",
    "routes": [
      "GET /api/agent",
      "GET /api/agent/notes",
      "GET /api/agent/notes/:noteId",
      "GET /api/agent/stats",
      "GET /api/agent/audit",
      "GET /api/agent/connections",
      "POST /api/agent/connections",
      "DELETE /api/agent/connections/:connectionId",
      "DELETE /api/agent/connections",
      "POST /api/agent/notes",
      "PATCH /api/agent/notes/:noteId"
    ]
  }
}
```

### Routes and the scope each one needs

| Route | Needs |
| --- | --- |
| `GET /api/agent` | any valid token |
| `GET /api/agent/notes` | `notes:read` |
| `GET /api/agent/notes/:noteId` | `notes:read` |
| `POST /api/agent/notes` | `notes:write` |
| `PATCH /api/agent/notes/:noteId` | `notes:write` |
| `GET /api/agent/stats` | a user token, plus `notes:read` |
| `GET /api/agent/audit` | `notes:read` |

The `id` in a note row from `GET /api/agent/notes` is the note id: pass it straight back to the
single-note GET or PATCH route. Both also accept the internal row id, so an id carried over from
an older call still resolves.
| `GET /api/agent/connections` | a user token |
| `POST /api/agent/connections` | a user token |
| `DELETE /api/agent/connections/:connectionId` | a user token |
| `DELETE /api/agent/connections` | a user token |

There are two scopes: `notes:read` and `notes:write`. A user JWT always
carries all four; an agent token carries exactly what was issued to it. A route the token's scopes do
not cover answers `403` naming the missing scope — and the human-only routes answer `403` for any
agent token, because an agent may not issue or revoke keys.

## 3. Read notes

```bash
curl -sS "$BASE/api/agent/notes?limit=50" -H "Authorization: Bearer $TOKEN"
```

```json
{
  "success": true,
  "data": [
    {
      "note_id": "note-1730000000000-ab12cd",
      "title": "Weekly review",
      "content": "# Weekly review\n\n- shipped the agent API docs\n",
      "folder": "private",
      "is_pinned": false,
      "created_at": "2026-10-14T08:00:00.000Z",
      "updated_at": "2026-10-16T07:30:00.000Z",
      "created_by": "user-123",
      "created_by_name": "ves@example.com",
      "updated_by": "user-123",
      "updated_by_name": "ves@example.com",
      "revision": "4"
    }
  ],
  "pageInfo": { "hasMore": false, "nextCursor": null, "limit": 50 }
}
```

- `limit` defaults to 200 and is capped at 500.
- `revision` is the note's version as a string, and it is the value to send back when you write.
- Rows also carry the notebook's internal columns (`user_id`, `version`, `deleted_at`); ignore them and
  rely on the fields above.
- Deleted notes are never listed.
- The list carries full content, so `GET /api/agent/notes/:noteId` is for one note, not for the body
  you already have. It answers the same row plus an `ETag` header:

```bash
curl -sS "$BASE/api/agent/notes/note-1730000000000-ab12cd" -H "Authorization: Bearer $TOKEN"
```

Paging is a cursor, never an offset — the list is ordered by `updated_at` descending, so an offset
would skip or repeat rows while somebody types:

```bash
curl -sS "$BASE/api/agent/notes?limit=200&cursor=$NEXT_CURSOR" -H "Authorization: Bearer ***"
```

### Polling for changes

`since` takes an ISO 8601 timestamp and returns only what changed after it. Every answer carries
`pageInfo.since`, which is the value to send next time — taken when the answer was made, so a write
that lands during the query is not skipped. Nothing changed costs about 120 bytes.

```bash
curl -sS "$BASE/api/agent/notes?since=2026-11-11T12:47:38.562Z" -H "Authorization: Bearer ***"
```

A `since` that is not a timestamp answers `400` with the shape it expects, never an empty list.

## 4. Create a note

```bash
curl -sS -X POST "$BASE/api/agent/notes" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Notes from the agent", "content": "First line.\n\nSecond line.\n"}'
```

`201`, the created note (with `revision`) and an `ETag`. Title and content are the only fields worth
sending. A note created this way is stamped `folder: "agent"` and its row says who wrote it, but the
authorship — not the folder — is what marks it: the row is attributed from `created_by`, and the
notebook groups notes by authorship (mine, an agent's, both), never by folder. `folder` is stored as
a label and shown nowhere; a `userId` in the body must match the authenticated user, or the answer
is `403`.

## 5. Edit a note without losing somebody's edit

Read, then write back the revision you read. This is the whole contract:

```bash
NOTE=note-1730000000000-ab12cd

# 1. read it, and keep the revision
REV=$(curl -sS "$BASE/api/agent/notes/$NOTE" -H "Authorization: Bearer $TOKEN" | jq -r '.data.revision')

# 2. write it back with that revision
curl -sS -X PATCH "$BASE/api/agent/notes/$NOTE" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"content\": \"# Weekly review\n\n- shipped the agent API docs\n- and the conflict loop\n\", \"ifRevision\": \"$REV\"}"
```

- `200` — written; the response carries the new `revision`.
- `428` — you sent no revision. The note is unchanged; read it, then retry with `ifRevision`.
- `409` — somebody wrote in between. The response carries the current note in `data` and its revision
  in `currentRevision`; re-read, merge your change into the current text, and retry with that revision.
  Never retry with the revision you already had: that is the same `409` again.

`If-Match: "<revision>"` is accepted instead of `ifRevision` in the body, so a plain HTTP client can
use it. `title` and `content` are both optional; send the ones you are changing.

The same loop as a script — an agent that appends one line to a note, retrying on a conflict:

```js
const BASE = process.env.CANONOTE_URL;
const TOKEN = process.env.CANONOTE_AGENT_TOKEN;
const NOTE = process.env.CANONOTE_NOTE_ID;

const call = async (path, init = {}) => {
  const response = await fetch(`${BASE}/api/agent${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  return { status: response.status, body: await response.json() };
};

export async function appendLine(line) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const read = await call(`/notes/${NOTE}`);
    if (read.status !== 200) throw new Error(`read failed: ${read.status} ${read.body.error}`);

    const { content = '', revision } = read.body.data;
    const next = `${content.replace(/\n*$/, '')}\n- ${line}\n`;

    const write = await call(`/notes/${NOTE}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: next, ifRevision: revision }),
    });
    if (write.status === 200) return write.body.data;
    // 409: somebody edited it while we were reading — read again and retry.
    if (write.status !== 409) throw new Error(`write failed: ${write.status} ${write.body.error}`);
  }
  throw new Error('gave up after three conflicts');
}
```

## 6. Read the trail

Every note an agent creates or edits is recorded, and this is the read:

```bash
curl -sS "$BASE/api/agent/audit?limit=20" -H "Authorization: Bearer $TOKEN"
```

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
  "pageInfo": { "limit": 20, "returned": 1, "hasMore": false }
}
```

- The trail is scoped to the **owner of the notes**, not to the actor: a delegated key and the person who
  issued it read the same events, because the events are about the notes.
- `limit` defaults to 100 and is capped at 200. Newest first; `hasMore` says whether older events exist.
- A static token with no `AGENT_OWNER_USER_ID` owns no notes and answers `403` rather than an empty list
  — "nothing has happened" and "this key owns nothing" are different answers.
- `beforeHash` and `afterHash` are the sha256 of the note's title and content before and after the write;
  `notes.create` has no `beforeHash`.
- `action` is `notes.create` or `notes.update`. An action this build does not know is still shown as it
  was recorded.
- The trail is append-only: there is no route that deletes an event.

## 7. Errors

Every failure is the same shape, and the status says whose problem it is:

```json
{ "success": false, "error": "Forbidden. Missing required scope: notes:write" }
```

| Status | Means |
| --- | --- |
| `400` | the request is malformed — a missing id, an invalid scope, an expiry in the past or beyond the maximum lifetime |
| `401` | no usable token: absent, unknown, revoked, or expired |
| `403` | the token is valid but not allowed here: a missing scope, a human-only route, a body `userId` that is not the authenticated user, or a token with no owner reading the audit trail |
| `404` | no such note or connection for this user |
| `409` | revision conflict — read again and retry with the current revision |
| `428` | a revision is required for this write |
| `429` | the user's active-connection limit is reached |
| `500` | a real server fault |
| `503` | no database configured on this deployment |

## 8. Limits and configuration

| Setting | Default | Meaning |
| --- | --- | --- |
| `AGENT_MAX_CONNECTIONS_PER_USER` | 5 | active delegated connections per user; further issues answer `429` |
| `AGENT_MAX_CONNECTION_TTL_MS` | 180 days | longest `expiresAt` a connection may be issued with |
| `AGENT_API_TOKEN`, `AGENT_API_TOKENS` | — | legacy static tokens (comma-separated) |
| `AGENT_OWNER_USER_ID` | — | the user a static token acts as; required with a static token |
| `AGENT_TOKEN_SCOPES_JSON`, `AGENT_TOKEN_EXPIRATIONS_JSON` | all four scopes, no expiry | per-static-token scopes and expiry |
| `CORS_ALLOWLIST` | localhost + the Vercel project URL | origins allowed to call the API from a browser |

Request size and pagination limits: `limit` 500 notes per page, 200 by default.

## 9. What this API is not

- It is not the notebook's own storage. The notebook is local-first and edits markdown in the browser
  (or in a folder you pick); this API writes the canonical notes in the hosted database. With the
  hosted layer configured they are the same notebook seen from two sides — the agent's writes arrive
  as agent-authored notes in the `agent` folder, and the human's edits are what the next read returns.
- It does not make the agent's changes silent. Every write lands in `note_versions` with the agent's
  name on it, and any version can be restored in one click — a restore is itself a new version by the
  person, so nothing is erased. See [API_CONTRACTS.md](./API_CONTRACTS.md).
