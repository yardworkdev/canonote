# Live cursors — spec v1

Status: proposed, not started. Written 2026-11-09.

## What it is

Two writers in one note, both visible. You see where the agent is working while it works, and
it sees where you are. The note stays a plain markdown textarea; nothing about the storage model
changes.

## The one decision that shapes everything

**Presence is not a lock, and it is not co-typing.**

- Not a lock: seeing a cursor never blocks a write. Writes stay guarded by `ifRevision`, exactly
  as they are today (`409` → merge → retry). A cursor that granted permission would be a second
  permission system, and the first one is already correct.
- Not CRDT co-typing: two people typing in the same paragraph, character by character, needs a
  CRDT and a rewrite of the save pipeline (revision → vector clock). That is a different product
  and it would break the thing that makes canonote trustworthy — one canonical note with a
  revision you can point at. **Explicit non-goal for v1.**

What ships instead: *curiosity, not collision.* You can see the agent working, and it can see you.

## What an agent "cursor" is

An agent does not have a caret. It has a target. So presence carries a kind:

```json
{ "k": "human", "id": "u_1f3", "name": "Ves",  "from": 412, "to": 412, "at": 1762…  }
{ "k": "agent", "id": "a_rudi", "name": "Rudi", "mode": "reading",   "at": 1762…  }
{ "k": "agent", "id": "a_rudi", "name": "Rudi", "mode": "proposing", "from": 380, "to": 512, "at": … }
{ "k": "agent", "id": "a_rudi", "name": "Rudi", "mode": "writing",   "from": 512, "to": 512, "at": … }
```

The agent's `mode` is the useful part: *reading* (it is fetching a body), *proposing* (a range is
about to be suggested — render it as a ghost span), *writing* (it is appending). The human sees,
at a glance, that the thing changing their note is looking, suggesting, or committing.

An agent announces presence by calling its own API, not by opening a browser:

```
POST /api/agent/presence   { "noteId": "note-123", "mode": "proposing", "from": 380, "to": 512 }
```

`notes:read` scope is enough for `reading`; `proposing` and `writing` need `notes:write`. The
server checks the per-note switch (migration 015) — an agent cannot announce itself in a note it
cannot see, and an `agent_access = false` note answers `404` here too.

### What shipped, and the gap that closed

Presence is a 3 s poll, not Realtime, and the route is
`POST /api/agent/notes/:id/presence` — announcing a caret and reading one back have to hit the same
function, because the store is that function's memory.

The person's caret used to cross a `BroadcastChannel` only: an agent could announce its own caret
and the page drew it, but no agent could read where the person was typing. The page now writes its
caret to that same route with the session token — `kind: 'person'`, one keyed entry per note, no
invented mode, `from`/`to` only — and an agent's `GET` returns it beside the agents. The person's own
poll filters it out, so they never see a second mark of themselves. `npm run check:caret-up` proves
the round trip on the deployed app: the page publishes with no help from the test, the agent reads
the offset the editor reports, it follows a move, and it expires when the tab closes.

## Transport

**Supabase Realtime broadcast**, one channel per note: `note:<user_id>:<note_id>`, `self: false`.
It is already in the dependency tree, it is WebSocket, and it does not require a new service or a
new vendor account.

- Local-only notebook (no Supabase): fall back to `BroadcastChannel('note-presence:<id>')`. Same
  payload, so two tabs on one laptop show each other's cursor with no server at all.
- Message size cap: 160 bytes. Presence is a heartbeat, not a document.

## Lifecycle

| Rule | Value | Why |
|---|---|---|
| heartbeat | every 4 s | liveness without traffic |
| expiry | 12 s without a beat | a closed tab disappears in one breath, not one minute |
| cursor throttle | 10 msgs/s, coalesced to the last position | typing must not become a network loop |
| on blur | send `away`, keep the entry dimmed | "here but not looking" is different from gone |
| on `beforeunload` | send `leave` | best effort; expiry is the real guarantee |

Presence is stored **in memory on the server, per channel, with the heartbeat's own timestamp** —
never in Postgres. A crashed process loses presence and that is correct: presence is not history.

## Rendering

- Human cursors: a 2px caret and a 10px name tag at the anchor, in the note's own grey ramp —
  no new colour, no avatar bubbles.
- Agent presence: the same caret, but with the agent's name preceded by its mark (`Rudi · reading`),
  and the proposed range shown as a ruled ghost block (a left border, no fill), matching the
  suggestion surface that already exists.
- Nothing animates except the caret's own blink. A pulsing "AI is thinking" badge is the tell this
  product refuses.

## Failure modes, decided up front

| Failure | Behaviour |
|---|---|
| channel won't connect | presence is silently absent; editing is unaffected. No banner — presence is a courtesy, not a dependency |
| agent never sends `leave` | entry expires in 12 s |
| two tabs share a user id | both appear; the name tag carries the tab's own short id |
| note switched off for agents mid-session | the agent's presence drops on its next beat (404), the human keeps typing |
| revision conflict while an agent cursor is visible | unchanged: `409`, merge, retry. Presence never blocks the save |

## What v1 does not include

- Co-typing / CRDT (see above).
- Cursors inside the split view's second pane (v1 is the active pane only).
- Presence history ("who was here yesterday") — that is what `note_versions` is for.

## Tests

1. Two Playwright contexts on one note see each other's caret within 1 s; both names correct.
2. A fake agent publishing `proposing` renders a ghost range at the exact offsets.
3. Killing a context drops its caret within 12 s — measured, not asserted by sleep alone.
4. A note with `agent_access = false` rejects `POST /api/agent/presence` with `404`.
5. Payload budget: a cursor message serialises to ≤160 bytes (unit test on the encoder).
6. Throttle: 200 keystrokes in 2 s produce ≤20 messages (unit test on the coalescer).
7. Switching notes clears the previous note's transport and leaks no timers (fake timers + assert
   no pending intervals).

## Cost

Roughly: 250 lines of client (encoder, throttle, channel, render) + 90 lines of server (presence
route, TTL map) + the ghost-range component. One new migration is **not** needed.
