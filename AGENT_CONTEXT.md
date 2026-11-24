# The context economy: entering cheap, reading little

A notebook an agent can see, with an on/off switch per note, and an API shaped so the agent does
not carry the notebook in its context window. Every number below was measured against the
deployed site on 11 Nov 2026, on a 25-note notebook.

This file describes the API that runs. It used to describe another one — `cn_live_` keys,
`part=body`, `propose`, `423` switches, `search` — which does not exist in this codebase.

## Enter

One authenticated GET. There is no unauthenticated manifest: a token is the way in, and it is
issued in the app (Helper View → Agent).

```bash
curl -s https://canonote.vercel.app/api/agent -H "Authorization: Bearer $TOKEN"
# {"success":true,"data":{"agent":"Promi","authType":"agent","userId":"…",
#  "scopes":["notes:read","notes:write"],"expiresAt":"…","version":"…","routes":[…], …}}
```

**533 bytes.** It names the agent, its scopes, when the token expires, and the routes. It contains
no note and no note content.

## Read

```bash
curl -s "https://canonote.vercel.app/api/agent/notes?limit=50" -H "Authorization: Bearer $TOKEN"
```

**249 bytes per note** — the whole 25-note notebook as metadata is 6,229 bytes. A row carries only
what a next call needs:

| Field | What it answers |
|---|---|
| `id` | the note id to pass to every other route |
| `title` | which note this is |
| `revision` | the version to send back with a write |
| `updated_at`, `created_at` | whether it moved since you looked |
| `tags` | how it is filed |
| `contentBytes` | whether the body is worth fetching |
| `written_by` | who wrote it last: a person's name, or the agent's |

Bodies are not in the list. One note, with its text, is **770 bytes**:

```bash
curl -s "https://canonote.vercel.app/api/agent/notes/$NOTE_ID" -H "Authorization: Bearer $TOKEN"
```

Paging is an opaque cursor (`pageInfo.nextCursor`), never an offset: the list is ordered by
`updated_at` descending, so an offset would skip a row that changed while you were paging.

## Poll for what changed

```bash
curl -s "https://canonote.vercel.app/api/agent/notes?since=2026-11-11T12:47:38.562Z" \
  -H "Authorization: Bearer $TOKEN"
```

`since` takes an ISO 8601 timestamp and returns only notes whose `updated_at` is later than it.
`pageInfo.since` in every answer is the timestamp to pass next time, taken when the answer was made
so nothing written during the query is skipped. **Nothing changed costs 120 bytes.** A `since` that
is not a timestamp is a `400` naming the expected shape, not an empty list.

This is the alternative to a webhook: polling costs less than delivery machinery, adds no endpoint
for a stranger to call, and an agent that acts on request does not need to be woken.

## Write

```bash
# read first, keep data.revision
curl -s -X PATCH "https://canonote.vercel.app/api/agent/notes/$NOTE_ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"…","ifRevision":203}'
```

`ifRevision` that does not match the server's is a `409` and nothing is written; omitting it is a
`428`. A write is attributed to the agent's name, and the character range it wrote is recorded, so
the notebook can put a grey band behind exactly those characters.

## Talk to the person (the thread)

A note has a thread: a conversation that outlives your process, stored as rows. Read it before you
write, and prefer it to writing.

```bash
# what has been said, oldest first; `since` makes the poll cheap
curl -s "https://canonote.vercel.app/api/agent/notes/$NOTE_ID/messages?since=2026-11-11T12:47:38Z" \
  -H "Authorization: Bearer ***"

# a message
curl -s -X POST "https://canonote.vercel.app/api/agent/notes/$NOTE_ID/messages" \
  -H "Authorization: Bearer ***" -H "Content-Type: application/json" \
  -d '{"body":"The closing section is repetitive.","kind":"note"}'

# a change you want, offered instead of made
curl -s -X POST "https://canonote.vercel.app/api/agent/notes/$NOTE_ID/messages" \
  -H "Authorization: Bearer ***" -H "Content-Type: application/json" \
  -d '{"body":"A tighter closing paragraph.","kind":"proposal","baseRevision":204}'
```

**A proposal carries the revision it was written against** (`baseRevision`, the same number you pass
as `ifRevision`). Omitting it is refused. The person sees the text in full, presses Apply or
Dismiss, and applying writes it through the editor's guarded save — so a note that moved on refuses
the placement instead of dropping a paragraph somewhere it was never meant to go.

An agent has no route that applies a proposal: deciding is the person's. Proposals never change a
note by themselves, which is why offering one is safe to do often.

A message is capped at 2000 bytes, an answer returns at most 50, and the note's agent switch governs
the whole thread — a switched-off note answers `404` here too.

## The switch

A note switched off for agents answers `404` on every route — including the single-note read — so
the agent cannot tell "switched off" from "does not exist". Nothing an agent can call turns a note
back on. Only the person, in the app, can.

## Keys

Issued in the app: Helper View → Agent, a name and one button. Shown once, stored as a hash,
thirty days, `notes:read` + `notes:write`, revoked in the same list. A token cannot flip a note's
switch, cannot list connections, and cannot read stats.
