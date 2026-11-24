# AGENTS.md

Read this before opening a source file. It describes the code that exists today.
`README.md` is the user-facing promise, `AGENT_API.md` is the agent contract, and
`API_CONTRACTS.md` is the route reference. If any of them disagree with the code,
the code wins — fix the document in the same commit.

---

## What this is

canonote is a local-first markdown notebook, and the notebook is a shared memory between
a person and their agents: readable by humans, operable by agents, cheap for an agent to enter,
and safe to leave switched on.

An agent is a second client of the same notes, not a feature bolted onto a chat box. There is
no in-app AI chat, no model key in the browser, and no prompt anywhere in this repo. An agent
reads and writes `/api/agent/*` with a token its owner issued, under its own name.

Three properties are the product, and a change that weakens one needs a reason:

1. **The notes are really stored.** IndexedDB is the primary store, `localStorage` the fallback,
   and the footer says which one is in use. A storage failure is reported, never papered over.
2. **The agent cannot see what it was not given.** A note switched off answers `404` on every
   agent route — never `403`, because `403` confirms existence. Nothing an agent can call turns
   it back on.
3. **Nothing happens silently.** Every write carries an author, every version is kept, and any
   version restores in one click. A restore is itself a new version by the person.

---

## Non-negotiables

- **404, not 403, for anything withheld.** Hidden notes, missing notes, hidden-note presence.
- **One contract, two implementations, one test.** `scripts/conformance.mjs` boots the Node
  reference server and the Rust sidecar and compares them. A change to either goes through it.
- **Never ship a green-by-default test.** If a promise cannot be proven, narrow the promise and
  delete the test. A browser check that passes because it never ran is worse than no check.
- **Write routes validate their bodies** through `api/_lib/validate.js` (valibot). A wrong type is
  a `400` naming the field; it is never a silent bad write.
- **No TypeScript in the UI.** `api/` is type-checked with JSDoc via `tsconfig.api.json`; JSX stays JSX.
- **Do not modify applied migrations** (`001`–`020`). Add `021_*.sql`.
- **No native dialogs.** `dialog.confirm()` / `dialog.prompt()` from `src/utils/dialog.js`.

---

## Commands

| Command | What it proves |
|---|---|
| `npm run verify` | typecheck (`api/`) + unit tests + build — the gate before every commit |
| `npm run lint` | ESLint; zero errors is the bar (warnings are tracked) |
| `npm run dev` | Vite dev server on :5173 |
| `npm run test` | Playwright end-to-end suite (~6 minutes, 87 tests) |
| `npm run test:unit` | vitest only (72 files, 702 passed, 3 skipped) |
| `npm run check:bundle` | every built surface stays inside its byte budget |
| `npm run audit:artifact` | no built href/src points outside `dist/`, every route exists |
| `npm run contract` | boots the reference server, then runs enter → write → access → presence → conformance |
| `npm run conformance` | Node vs Rust on the same request vectors |
| `npm run check:presence` | two real tabs, each sees exactly one other person |
| `npm run check:save` | type → "Saved" → reload → the text survived |
| `npm run check:live` | the deployed site, checked like a stranger meets it |
| `npm run check:first-note` | a brand-new account's first note reaches the server and survives a reload |
| `npm run check:eye` | the per-note agent switch answers a real mouse click |
| `npm run check:powers` | what a token can and cannot do, asked of the live API |
| `npm run check:attribution` | an agent's words carry a background, and it stays on them while typing |
| `npm run check:new-note` | pressing "+" mid-save never hands the old text to the new note |
| `npm run check:plus-focus` | "+" takes the caret, and one press makes exactly one note |
| `npm run check:offline` | the built shell is cached, and `/app` opens with the network cut and the note intact |
| `npm run check:slow-load` | a slow read never shows the note you just left |
| `npm run check:hung-save` | a save that never answers ends in a sentence, not in "Saving…" |
| `npm run check:token-used` | a token's row can say when it was last used |
| `npm run check:thread` | an agent and a person talk on a note, and an agent cannot approve its own proposal |
| `npm run check:thread-store` | the thread's table refuses what the contract says it must |
| `npm run check:all` | every check above, in one command, with one exit code |
| `npm run deploy` | Vercel deploy as the project owner (needs `VERCEL_TOKEN`) |

The gate is local and manual: run it, read it, then commit. There is no CI on this repository, so
the commands above are the contract — a change is not done because a workflow said so. Deploy one
verified batch at a time; the reference deployment runs on a Hobby plan.

---

## Repo layout

```
main.jsx                     bootstraps storage, then renders App
src/
  App.jsx                    shell: layout, modals, shortcuts, toasts (999 lines)
  context/AppContext.jsx     the hook chain, exposed as useApp()
  hooks/                     all stateful logic
  components/                UI surfaces (PascalCase.jsx)
  services/                  storage, sync, presence, save-outcome, notes-api
  utils/                     markdown, export, dialog, ids, api auth
api/
  notes.js                   UI-facing notes API
  agent.js                   agent API
  auth/log.js, auth/lookup.js  auth debug logging + email lookup (candidates for removal)
  _lib/                      handlers, validation, authz, presence, history, cors
  ../src/lib/attribution.js  the span maths, shared by the server and the editor
supabase/migrations/         schema history, 001–020 applied
scripts/                     proofs: conformance, contract, presence, save, live, audits
rust/canonote-agent/         the sidecar, held to the same contract
tests/                       Playwright end-to-end
```

---

## Boot sequence

`main.jsx` runs before React:

1. Creates a `localStorage` adapter synchronously and assigns it to `window.storage`
   (a setter that silently ignores anything that is not a compatible adapter).
2. `bootstrap()` calls `initializeStorage()`, which opens IndexedDB and migrates any existing
   `localStorage` notebook into it.
3. On success `window.storage` is the IndexedDB adapter; on failure it stays the `localStorage`
   adapter and the app says so rather than pretending.

Any code reading `window.storage` synchronously in a lazy initialiser gets the fallback adapter.
Async reads get the final one.

---

## State graph

Assembled once in `src/context/AppContext.jsx`:

```
useStorage(null) → useAuth(storage) → useStorage(user) → useNotes(user, storage) → useEditor(...)
```

The order is a hard constraint: identity before note state, notes before the editor. Components
read `useApp()` → `{ auth, storage, notes, editor }`. `setUser` is not exposed.

---

## Storage

| Surface | Module | Holds |
|---|---|---|
| IndexedDB | `src/services/indexeddb-storage.js` | the notebook: note content, metadata, journal |
| `localStorage` fallback | `src/services/browser-storage.js` | the same notebook when IndexedDB is unavailable; also small prefs |
| Direct `localStorage` | — | browser-only prefs only, never note content |

Notes live under user-scoped keys (`<userId>:note-<id>`, `<userId>:notes-cache`). Two accounts on
one browser never share note keys. `src/services/storage-health.js` answers "is this stored?", and
`save-outcome.js` turns the answer into a sentence the footer can show.

---

## Editor

`src/components/MarkdownEditor.jsx` is a controlled `<textarea>` with selection and insertion
primitives exposed through a ref. It contains no formatting logic; `useEditorPane` builds markdown
edits from those primitives, and `Toolbar` calls them. There is no rich-text layer and no
HTML↔markdown round trip any more — the note is markdown, and what is on screen is the note.

Split view is two panes with a draggable ratio, persisted per user. `useEditor` proxies every
action to the active pane.

---

## Save pipeline

`src/hooks/useNotePersistence.js` (1,232 lines) owns typing → local write → canonical sync:

1. Keystroke → `saveStatus = 'saving'` immediately.
2. Idle write to the local store (`requestIdleCallback`, 1,500 ms fallback).
3. `PATCH /api/notes/:noteId` with `content` and `ifRevision`.
4. `200` → advance the revision, show "Saved"; `409` → conflict recovery; other → error.

Every answer is interpreted in one place: `src/services/save-outcome.js` maps saved / conflict /
precondition / missing / offline / error to a message and to whether retry or rebase applies. The
404 path does not resurrect a deleted note — the note stays deleted and the draft is kept.

Writes are serialized through a promise chain; concurrent edits cannot race.

---

## The thread

`note_messages` (migration `021`) is the conversation on a note, and it exists to make one promise
structural: **an agent cannot change your text silently.** An agent that wants a change writes a
`proposal` message carrying the revision it was written against; the person sees the text in full and
presses Apply, which reaches the note only through the editor's normal guarded save
(`src/lib/proposal-apply.js` places it or refuses as `stale`). An agent has no route that applies a
proposal — deciding is `POST /api/notes/:id/messages/:messageId`, a signed-in route.

It is a table, not the presence store: presence is a heartbeat that should disappear, a message has
to survive a redeploy. `src/hooks/useThread.js` polls it every five seconds with a cursor and stops
while the tab is hidden. The note's agent switch governs the whole route: a switched-off note answers
`404`.

## Presence

`src/hooks/usePresence.js` carries two transports into one list:

- **People** over `BroadcastChannel('canonote-presence:<noteId>')` — same browser only.
- **Agents** by polling `GET /api/notes/:id/presence` every 3 s while the note is open, fed by
  `POST /api/agent/notes/:id/presence` from the agent.

Heartbeat 4 s, expiry 12 s, 160 bytes per message, 10 messages a second, eight agents per note
server-side, nothing persisted. A stale caret is never shown: every read re-filters by its own
timestamp. Presence is curiosity, not a lock — writes stay guarded by `ifRevision`.

---

## Auth

Supabase only. `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` set → sign-in, canonical notes and
the agent API are live. Unset → local notebook, no accounts, no agent API.

`useAuth` exposes the session and the sign-in/sign-up/reset actions. `getUserSessionAuthHeaders()`
in `src/utils/apiAuth.js` is the only way the browser authenticates a call.

---

## Server API

Three APIs with three auth models:

- **`/api/notes`** — the UI's API. Supabase JWT only; agents cannot call it. Routes:
  `GET /`, `GET /:id`, `POST /`, `PATCH /:id` (content + `ifRevision`, and the per-note agent
  switch), `DELETE /:id`, `GET /:id/history`, `POST /:id/revert`, `GET /:id/presence`.
- **`/api/agent`** — the agent's API. Token in `Authorization: Bearer` or `x-agent-token`, never in the
  URL: `?token=` is answered as if no token were sent (a URL lands in logs, `Referer` and history);
  resolved as static env token, then delegated connection token (SHA-256 hash in
  `agent_connections`), then Supabase JWT. Scopes: `notes:read`, `notes:write`.
  `GET /` (manifest), `GET /notes`, `GET /notes/:id`, `POST /notes`, `PATCH /notes/:id`,
  `POST /notes/:id/presence`, `GET /stats`, `GET /audit`, and the connection routes a human uses.
- **`/api/auth/log`, `/api/auth/lookup`** — debug scaffolding, not product.

Agents are issued from the Helper View's Agent tab: a name and one button. There is
no separate collaboration panel, no token paste field and no expiry picker — a token
lasts thirty days, carries `notes:read` and `notes:write`, and is revoked in the same
list it appears in.

A delegated token is issued by a signed-in human, stored as a hash, shown to its owner once, and
revocable. The agent acts as that person with fewer rights: it cannot flip a note's switch, cannot
list connections, cannot see stats.

---

## History and revert

`note_versions` (migration `012`) keeps every canonical version with its author. `GET
/api/notes/:id/history` returns them; `NoteHistory.jsx` renders them with a Restore button. A
restore reads the old version and writes it as a **new** version through the normal guarded path,
so it cannot clobber a concurrent change and nothing is ever erased.

---

## Agent context

`AGENT_CONTEXT.md` is what an agent reads first: how to enter cheaply, what the byte caps are, and
which call answers which question. `GET /api/agent` answers a manifest in ~560 bytes; lists are
metadata-only; bodies are capped by `maxBytes`. Entering the notebook must not cost a context
window.

---

## Deploy and the live check

Vercel. Server env: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`. Build env: `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`. Without the server pair every data route answers
`503 Database not configured` — the build still renders, and `npm run check:live` says exactly that
instead of looking green.

---

## Traps

| Trap | Why it bites |
|---|---|
| `useNotePersistence.js` is 1,232 lines with imperative refs | Read `save-outcome.js` first; the meaning of each answer is already decided there |
| Presence is per-lambda in memory | An entry can be invisible for a moment when a heartbeat lands elsewhere; never render a stale caret to hide it |
| `App.jsx` is monolithic | Understand the Suspense lazy surfaces before adding a panel |
| `api/_lib/agent-handler.js` is 908 lines | Connection plumbing, notes, presence and audit in one file; read the route table before editing |
| The Rust sidecar is not the app | Production runs the Node handler; the crate exists to prove the contract and to measure memory |
| `dialog.js` queues dialogs | Overlapping `confirm()` calls are shown one at a time, not both |
| Migration `010` adds the `version` column | Without it the `eq('version', …)` guard is silently skipped and concurrent saves can overwrite |

---

## Where to start

| Task | Start here | Then |
|---|---|---|
| Note list, search, sync | `src/hooks/useNotes.js` | `api/_lib/notes-handler.js` |
| Save, conflict, offline | `src/hooks/useNotePersistence.js` | `src/services/save-outcome.js` |
| Editor, formatting, split view | `src/hooks/useEditorPane.js` | `src/components/MarkdownEditor.jsx` |
| Presence | `src/hooks/usePresence.js` | `api/_lib/presence.js`, `src/services/presence-codec.js` |
| Agent API | `api/_lib/agent-handler.js` | `AGENT_API.md`, `run conformance` |
| Per-note agent access | `api/_lib/agent-access.js` / the eye in `Sidebar.jsx` | migration `015` |
| Issuing an agent token | `src/components/AgentTab.jsx` (Helper View → Agent) | `src/services/agent-connections.js` |
| History, revert | `src/components/NoteHistory.jsx` | `api/_lib/note-history.js` |
| Auth | `src/hooks/useAuth.js` | `src/services/supabase.js` |
| Adding a route | `api/_lib/validate.js` | a schema, a handler branch, a contract test |
| New migration | `supabase/migrations/015_note_agent_access.sql` | add `016_*.sql`, never edit applied files |

---

## Verification before saying done

1. `npm run verify` — typecheck, 702 unit tests, build.
2. `npm run lint` — zero errors.
3. If it touches the save path: `npm run check:save`.
4. If it touches presence: `npm run check:presence`.
5. If it touches the agent API or the sidecar: `npm run contract`.
6. If it touches a UI surface a person uses: `npm run test` (87 Playwright tests, ~6 min).
7. If it claims the site works: `npm run check:live` and paste the output.

A claim without one of these outputs is a guess.
