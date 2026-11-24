# canonote — the plan

Written 2026-11-09. This is the whole thing: what the product is, what it is made of, the order I
would build it in, how each piece is proven, and the decisions I would defend if asked.

## The product, in one sentence

A markdown notebook you already write in, where an agent is a first-class second author — it can
see every note and when it changed, write into them, and be switched off at the notebook or at a
single note, and it pays ~500 bytes to walk in rather than loading your notebook into its context.

The thing being sold is not "notes with AI". It is **shared memory with a door you control**.

## What the person does

1. Opens canonote. Notes are on the left, the note on the right, starting at the left edge.
2. Writes. Saves are local first; a server copy exists when signed in.
3. Sees an agent's presence in the note — `Rudi · reading`, `Rudi · proposing` — and a proposed
   range as a ruled block it can accept or decline.
4. Turns one note off for agents with the eye in the sidebar, or turns the whole API off with the
   switch. Flips it back without rotating a key.

## What the agent does (this is the part competitors do not have)

```
GET  /api/agent                              → 564 B manifest, no note content
GET  /api/agent/notes?since=…&fields=id,updated → 1,024 B for 40 notes
GET  /api/agent/notes/:id?part=meta          → 193 B
GET  /api/agent/notes/:id?part=body&maxBytes=1200 → 1,191 B
PATCH /api/agent/notes/:id  {op:"append"}    → unconditional, safe while a human types
```

A full working session costs ~5 KB for a 44 KB notebook, and no endpoint can return the notebook.
That is the moat and it is enforced by the API shape, not by a prompt.

## Architecture: three layers, one owner each

| Layer | Runs | Owns | Files |
|---|---|---|---|
| Notebook | browser | the text, its local copy, the UI | `src/` — `App.jsx` shell, `hooks/useNotes.js`, `useEditor*`, `components/Editor.jsx`, `Sidebar.jsx`, `NoteHistory.jsx` |
| Notes API | Vercel function | canonical note, revision, per-note flag, history | `api/_lib/notes-handler.js`, `notes-service.js`, `notes-repository.js`, `canonical-note.js`, `note-history.js`, `agent-access.js` |
| Agent API | Vercel function (or a 922 KB binary) | the contract, scope, byte budget, switch | `api/_lib/agent-handler.js`, `agent-context.js`, `notebook-store.js`, `authz.js`, `audit-log.js` |
| Presence | Supabase Realtime channel | who is here, for 12 s | new: `api/_lib/presence.js`, `src/hooks/usePresence.js` |

One rule holds the three together: **the browser never talks to Postgres directly and never trusts
its own revision.** Every write goes through a handler that checks the revision, and the revision
is a hash of the content.

## Languages and frameworks — decided, with evidence

- **JavaScript/JSX, not TypeScript.** The repo is 100+ plain JS files with 644 passing tests. A TS
  migration rewrites all of them and buys the user nothing. Types matter where the contract is
  subtle — the agent API — and there the byte budgets and tests are the type system.
- **React 18 + Vite + Tailwind**, plain markdown `textarea`, no rich-text editor. Boring and fast;
  a design change is one file and six seconds.
- **Rust: not the app.** Measured against the Node reference server on this box: p50 0.34–0.37 ms
  vs 0.54–0.65 ms (a rounding error), RSS 3.3 MB vs 64.7 MB. The memory win is real; the app is a
  browser program and would have to become WASM or a desktop shell to get it — costing the fast
  design loop that is my bottleneck. The compiled prototype (`canonote-rs`, 922 KB, same routes,
  same JSON, both client scripts pass unchanged) stays as an option for one thing only: a
  **single-file `canonote-agent` sidecar** for people who want to run the API next to their own
  machine with no Node at all. That is a later release, not a rewrite.
- **Supabase** for identity, canonical notes, version history, and Realtime. Already in the stack;
  no new vendor.
- **Nothing else.** No queue, no cache, no framework-of-the-month.

## Presence: two designs, and why the first wins

**Design A — channel broadcast, server-checked presence.** One Realtime channel per note; the
browser and the agent publish a 160-byte heartbeat every 4 s; entries expire in 12 s; presence is
kept in memory, never in Postgres. The agent announces itself through `POST /api/agent/presence`,
which checks scope and the per-note switch, so an agent cannot appear in, or learn about, a note it
cannot see. Local-only notebooks fall back to `BroadcastChannel`, same payload.

> **Changed 2026-11-19 — "never in Postgres" was wrong.** Measured on production: a caret announced
> through `/api/agent/notes/:id/presence` was present on that route and absent through
> `/api/notes/:id/presence`, same person, same note, same second, because the store was one
> process's memory. The transport decisions above stand; the storage one does not. Presence now
> lives in `note_presence` (one row per note and actor, pruned on every heartbeat, capped at eight,
> filtered on age at read), with the in-memory store kept as the fallback when the database refuses.
> Gate: `npm run check:presence-shared`.

**Design B — HTTP polling.** `GET /api/notes/:id/presence` every 2 s, entries cached server-side.
Simpler transport, no websockets, works on any host — but it turns a courtesy into a request every
two seconds per open note, and the interface is *fatter*: the client has to schedule, back off,
and reconcile timestamps.

A wins on interface depth: one publish, one subscribe, expiry handled by the receiver. Its failure
mode is the right one — if the channel is down, presence is simply absent and typing is unaffected.

**Rejected: CRDT co-typing.** Two people typing into one paragraph character by character needs a
CRDT and replaces the revision model the whole product is built on. Different product. Non-goal.

## The order I build in

Each slice ends with tests, a build, and a commit. Nothing is "done" without a run.

1. **Get what exists onto the live site.** The switch and history are committed but the deployed
   build is old. Needs a redeploy I cannot author (Vercel blocks commits it did not see from a team
   member). *Done when:* the live page shows the eye icon and the server history section.
2. **Presence, human side.** Encoder + throttle + channel + caret rendering + BroadcastChannel
   fallback. *Done when:* two browser contexts see each other within 1 s and a killed tab expires
   in 12 s, measured.
3. **Presence, agent side.** `POST /api/agent/presence`, modes reading/proposing/writing, ghost
   range rendering, switch enforcement (404 for an off note). *Done when:* a fake agent publishing
   `proposing` paints the exact range, and an off note rejects it.
4. **History you can act on.** Restore a server version, not just a local snapshot; `who` on every
   entry. *Done when:* restoring an agent's earlier write reproduces the note byte for byte.
5. **The proof page.** A public page that measures the claim: bytes for a real session against a
   naive "send me the notebook" API, regenerated from `scripts/agent-enter.mjs`. *Done when:* the
   numbers are produced by a script anyone can re-run.
6. **Public launch.** README that a stranger can follow, `/demo`, `npx`-less install, repo public,
   name. *Done when:* a clean clone + README works end to end on a machine that has never seen it.

## How it is proven

- **Unit** (`vitest`, 644 today): pure modules — byte caps, projection, revision guard, line deltas,
  presence encoder, throttle. Pure because tests that need a database rot.
- **Contract scripts**: `agent-enter.mjs`, `agent-write.mjs`, `agent-access.mjs` — the API exercised
  as an agent would, printing bytes and status per call.
- **Browser** (`playwright`): landing, `/demo`, the app with seeded notes, presence between two
  contexts.
- **Gates**: `npm run test:unit`, `npm run build`, `npm run lint`, `npm run audit:artifact`, and the
  design audit script. All five, every commit that touches the UI.

## Risks I am watching

| Risk | What I do about it |
|---|---|
| Supabase free-tier realtime limits | presence is ephemeral; if the quota is hit, the feature degrades to absent, not broken |
| Vercel blocking non-member deploys | every release needs one owner click; I will batch changes so it is one click, not five |
| Scope creep into co-typing | written down as a non-goal, twice |
| "Another notes app" reaction | the landing page leads with the byte count and the switch, not with markdown |
| Name | decided at launch, free to change while it is private |

## What I need from Ves

1. **A redeploy** of `main` on Vercel, so anything I ship is actually visible to you.
2. **A yes on going public** when slice 6 arrives — repo, name, domain.
3. **A line on the non-goal**: presence as *curiosity, not collision*. If you want real co-typing,
   say so now, because that changes the storage model, not just the UI.
