# Roadmap

The goal: **a calm, local-first markdown notebook your agent can write into**, released as a
1.0 that someone can use today and trust tomorrow. Work is organised in one-week slices; each slice
ships a working artifact plus its tests, never a design document.

Status: **Slices 1, 2, 4 and 5 and the release documents are complete** (slice 1 closed with the
accessibility pass, slice 4 with the message audit). Slice 3 — accounts and sync — is open and waits on
the storage decision. The front-end split (marketing page at `/`, notebook at `/app`) and the
minimal-surface design pass have shipped.

## Slice 1 — In-app design, fleshed out

- [x] Note list: row anatomy (title, first line, date, pin), hover/selection states, multi-select,
      bulk delete, empty and no-results states, long-title overflow — the row carries the note's
      second line (`previewFromMarkdown`), selection is a mode with a checkbox mark, Select all over
      the rows on screen and one bulk delete (`useNotes.deleteNotes`); a long title keeps the full
      text on hover — `tests/note-list.spec.js`
- [x] Editor chrome: title, save state, word/character count, cursor position in one quiet status row
      — the row carries the words, the caret's `Ln 3, Col 10` and the save state; the note's title sits
      in the toolbar above it (`WordCount.jsx`, `src/utils/cursor.js`, `tests/editor-chrome.spec.js`)
- [x] Toolbar: grouped controls, tooltips with shortcuts, disabled states, narrow-width overflow —
      six named groups (`role="group"`: Text formatting, Lists, Blocks, Notebook, Note actions,
      Panels), each tooltip naming the shortcut the control really answers to (`aria-keyshortcuts`
      announces the four that have one), Copy/Clear disabled while the note is empty with the reason
      in the tooltip, and a measured overflow menu that holds the block controls when the bar cannot
      (`ToolbarOverflowMenu.jsx`, `toolbar-controls.js`, `tests/toolbar.spec.js`)
- [x] Helper panels (AI, tags, history, contents): one header, one empty, one loading, one error —
      all four render through `src/components/HelperPanel.jsx` (`PanelHeader`, `PanelEmpty`,
      `PanelLoading`, `PanelError`); the panels that read nothing have no loading or error to show,
      and the one that reads the store distinguishes "no versions" from "the store refused the read"
      (`readNoteVersionsResult`, a `probeStorageAdapter` question, and the panel re-reading on
      `canonote:note-versions-changed` so an open panel's count stays true) —
      `tests/helper-panels.spec.js`, `src/components/NoteHistory.test.jsx`,
      `src/services/note-history.test.js`
- [x] One notice system with a documented tone; every message under test — every message an event
      raises lives in `src/services/notices.js`, keyed and carrying its tone, and a call site names a
      key rather than writing prose; `src/services/notices.test.js` holds the whole catalog to the
      tone standard (two sentences at most, no blame and no hype, a next step that can help on every
      error, one glance) and fails the build when a notice call passes a literal message
- [x] Accessibility: focus-visible everywhere, keyboard path through every surface, contrast checked —
      every ring, outline and focus border in `src/**` is the `focus-visible:` variant (a mouse click
      paints no ring), every dialog runs the one contract in `src/hooks/useFocusTrap.js` (Tab stays
      inside, Escape closes from the document, focus moves in and goes back to the opener), the helper
      tablist is one tab stop driven by the arrow keys with a real `role="tabpanel"`, and the keyboard
      path through both surfaces is asserted by `tests/keyboard.spec.js` (7 specs, four of them failing
      on the previous code before the fixes landed); contrast stays measured and axe-clean in
      `tests/a11y.spec.js`

## Slice 2 — Storage you can trust

- [x] IndexedDB as the source of truth (the store swap; the seam, the orphan scan, the health panel
      and the one save path are already store-agnostic — the remaining half is the adapter):
      `src/services/indexeddb-storage.js` (driver + adapter + the boot migration), Web Storage kept as
      the fallback, `tests/indexeddb-store.spec.js` proving the notes are really in the store
- [x] A write-ahead journal and recovery on open: a keystroke writes a record before the content it
      holds, and opening the notebook replays whatever a killed tab left behind — the note is listed
      with its text — `src/services/note-journal.js`, `src/hooks/useNotes.js`,
      `tests/edge-cases.spec.js`
- [x] One save path; a killed tab mid-save loses nothing — every content write in the editor goes
      through `commitNoteContent`, which commits the content and consumes the record that held it
- [x] Storage health panel: where notes live, how much space, when the last backup was — the
      **Storage** panel (`src/components/StorageHealth.jsx`, reached from the command palette), with the
      numbers from `src/services/storage-health.js` (`navigator.storage.estimate()` where the browser
      offers it, the measured store where it does not) and `tests/storage-health.spec.js`
- [x] Plain-language failure handling for the local store: a blocked browser is detected and stated in
      the status row instead of claiming notes are stored, and each storage failure (blocked, full,
      anything else) carries its own sentence with the step that can help — `describeStorageFailure`,
      `tests/storage-blocked.spec.js`; a corrupt cache with orphan content to recover is covered by the
      edge sweep
- [x] **Import** markdown files/zip (closes the export-only asymmetry), round-trip tested on real data
- [x] Rotating local backups + one-click "export everything" — a whole-notebook snapshot written on
      demand and once a day when the newest has gone stale, the newest three kept
      (`src/services/local-backups.js`); restoring only adds notes the notebook no longer has, and
      export-everything is on the same panel next to the numbers that make it necessary
- [x] **A folder the user picks**, as the seam's second adapter: the notebook opens a directory of the
      user's choice and every note is one real `.md` file in it (named after the note's title, holding
      exactly the markdown the editor shows), with the notebook's own index in `.canonote.json` beside
      them — a file dropped into the folder opens as a note and a file deleted there is a note deleted,
      and the Storage panel states the folder, offers to reconnect one the browser has forgotten, and
      can go back to the browser store without moving a file
      (`src/services/folder-storage.js`, `src/services/folder-storage.test.js`,
      `tests/folder-store.spec.js`). This is what makes the open storage decision an adapter swap

## Slice 3 — Optional accounts and sync

- [ ] Postgres + own auth (the existing migrations and repository layer are reused)
- [ ] Email + password (argon2id), verification, server sessions with rotation, reset, sign-out everywhere
- [ ] Sync with last-write-wins and a visible conflict log; offline queue that drains
- [ ] "Delete my account and my data" that exports first
- [ ] Security sheet: shared-store rate limits, CSRF/origin checks, audit log, threat model

Sign-in stays optional: the local notebook remains the default, so nobody is forced to create an account.

## Slice 4 — Agent API and keys, provably tested

- [x] Key lifecycle: create (shown once) → scope → use → expire → revoke, with revoke proven immediate
      — `src/api/agent-key-lifecycle.test.js` drives the real handler and the real `authz` through the
      whole lifecycle against a fake of `agent_connections` that honours the filters the code writes, so
      a revoked key really stops authenticating: the token comes back once, the issued scopes are the
      scopes it gets, a past expiry is refused, and revoke invalidates the key on the next request. The
      same suite holds the key out of logs, URLs and error payloads. A live e2e of the lifecycle needs a
      configured backend (the routes answer 503 without one), so the unit proof is the proof
- [x] Keys hashed at rest — the row carries `token_hash` (sha256 of the token) and a 12-character
      `token_prefix`, and the raw token appears in no stored row, no list response and no log
- [x] Audit log surfaced in the UI (who touched which note, when) — the events were written
      (`agent_connection_events` for a key, `agent_audit_log` for a note edit) and nothing could read
      them: the table carried the actor and the note but no owner, so the only read it supported was
      every user's events. Migration 014 adds the owner, `writeAuditEvent` records it, and
      `GET /api/agent/audit` (`api/_lib/audit-log.js`) returns the owner's trail newest-first, capped at
      200 (100 by default) — a token with no owner is `403`, a store that refuses is `500`, so an empty
      trail is never confused with a failed read. The notebook shows it as **Agent activity** in the
      command palette (`src/components/AgentActivity.jsx` over `src/services/agent-activity.js`): one
      line per event — what happened, to which note, by whom, when — and, in the shipped local mode, the
      honest fact that there is no account to read a trail from, with no request made at all
      (`src/api/audit-log.test.js`, `src/components/AgentActivity.test.jsx`,
      `tests/agent-activity.spec.js`, plus the panel in `tests/a11y.spec.js`)
- [x] Keys in headers only — `?token=` query acceptance removed (`getBearerToken` reads
      `Authorization: Bearer` and `x-agent-token` and nothing else; a query token is answered as
      unauthenticated — `src/api/authz.test.js`)
- [x] BYOK AI key handling: never logged, explicit errors for missing/invalid/rate-limited —
      the key lives in the tab's session storage only (the effect that copied an env key into
      `localStorage` is gone, and the settings panel states where it lives), every string that is
      logged or shown passes `redactKeyMaterial` (`src/services/ai-secrets.js`) so a provider error
      that echoes the credential cannot put it in the chat or the console, and the failures each say
      what happened — missing (`aiKeyMissing` / the setup screen), invalid (401 → `aiInvalidKey`),
      rate-limited (429 → `aiRateLimited`, retried with the provider's own `Retry-After`),
      over-quota (402 → `aiBilling`). `tests/ai-key.spec.js` proves it in a real browser and
      `src/services/openrouter.test.js` pins the URL, the header and the payload
- [x] Message audit with a tone standard; nothing vague where a fact is available — the standard is
      enforced over the whole copy now, not only the catalog: `src/services/copy-audit.js` reads every
      string a reader can see out of `src/` (JSX text, the attributes that carry copy, string literals),
      holds it to four rules (`no-shouting`, `no-emoji`, `no-blame`, `no-vague-failure`) and
      `src/services/copy-audit.test.js` runs it inside the unit gate — 87 files, 765 strings, 0
      violations; `node scripts/audit-copy.mjs` prints the inventory and the violations (`--all` prints
      every string). The audit's eight mechanical findings and four from the human read are fixed: the
      error boundary states the error it holds instead of "Something went wrong" and no longer tells the
      reader to clear their browser data, the export dialog's confirmations come from the catalog
      (`exported`, `copied`), a refused clipboard and a blocked print window tell the reader instead of
      ending in the console (`copyFailed`, `printBlocked`), and the shortcuts sheet, the empty state and
      the collaboration panel lost their hype and their factless failures
- [x] API docs and copy-paste examples for `/api/agent/*` — `AGENT_API.md` is the task-shaped half
      (get a key, call the API, walk the read-modify-write loop, the error table, the limits) beside
      `API_CONTRACTS.md`'s exhaustive shapes, and the examples are executed against the real handler by
      `src/api/agent-api-docs.test.js` — a documented route the API does not serve, or a documented
      status it does not answer, fails the unit gate. The document's route list is compared to the one
      `GET /api/agent` advertises, which was itself incomplete (`GET /api/agent` and
      `DELETE /api/agent/connections` were missing from it) and is fixed in the same change

## Slice 5 — Testing and release hardening

- [x] The gates run before every commit: unit, e2e, build, lint — locally, no hosted CI
- [x] Coverage thresholds enforced; an e2e spec per product surface
- [x] Accessibility sweep (axe) and fixes — `tests/a11y.spec.js`, ten surfaces plus a focus-ring
      sweep, all green; it caught the dead `dark:` variant, the sub-4.5:1 muted text, a nested
      button in every note row and the landing page's primary button
- [x] Performance budget: editor open, typing latency, bundle size — `npm run check:bundle`
      after the build and `tests/performance.spec.js` inside `npm test`; budgets and their measured
      values in [PERFORMANCE.md](./PERFORMANCE.md)
- [x] Edge sweep: empty, offline, expired session, second tab, huge note, unicode round-trip

## Slice 6 — 1.0 release

- [x] **Secret scan** over every blob in history and the tree (2026-10-10): no key material at HEAD;
      two OpenRouter keys inside the personal note exports and the dead Supabase project ref/URL/JWT
      exist in history only, and are removed by the scrub below
- [ ] Repository history scrubbed before publication (rewrite prepared and re-verified against the
      current history — 503→499 commits, `.git` 34 MB→4 MB, export/node_modules/credential objects
      all 0, the scrubbed HEAD tree identical to the shipped one; the force-push needs the owner's
      go-ahead)
- [x] Agent identities user-defined; no hardcoded agent branding — the name is a local setting
      (`agent-name`, `src/services/agent-settings.js` + `useAgentName`), used by the sidebar section,
      the row badge, suggestions and connection labels; set in the AI settings panel
- [x] LICENSE, CONTRIBUTING, SECURITY, issue templates, changelog (the `1.0.0` tag is cut at release)
- [x] README that leads with the differentiator: agent edits arrive as reviewable suggestions
- [x] Landing page brought to the same design rules; screenshots refreshed
