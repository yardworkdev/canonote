# Changelog

All notable changes to canonote are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). `1.0.0` is the first tagged release
(19 November 2026). The repository stays private for now; the tag records the state that passed the
whole gate, not a publication.

The log below 1.0.0 accumulated one entry per change as it was proved, so section headings repeat.
Nothing was removed from it.

## [Unreleased]

- **The gates run in a clone.** Every `check:*` / `live-*` script read its service key from an
  absolute path in the author's home directory and drove a browser from another, paths that exist on
  one machine and nowhere else: a clone failed with an `ENOENT` naming a directory the reader had
  never had. They now resolve credentials through `scripts/lib/secrets.mjs` (`<NAME>_FILE`, then
  `<NAME>`, then `<repo>/.secrets/<file>`, overridable with `CANONOTE_SECRETS_DIR`) and the browser
  through `scripts/lib/browser.mjs` (`CHROME_BIN`, otherwise Playwright's own). `npm run
  check:portable` proves the resolver's order and fails if any script hardcodes a home path again.
  Proved: `check:presence-shared` 12/12 and `check:caret-up` 12/12 after the change, against the
  deployed app.
- **`check:portable` is green on the tree that ships it, and a clone is measured.** It failed on its
  own branch — it flagged the example path in its own docstring. Prose may name the path it warns
  about, code may not, so the scan skips comment lines and self-tests both directions (9 checks).
  On a fresh `git clone`: `npm ci` 518 packages in 8 s, `npm run verify` 702 tests in 72 files +
  typecheck + build, `npm run lint` 0 errors, `check:portable` 9/9, and `check:live-app` 7/7 — the
  notebook served from `dist/` and driven as a person uses it — with no credential at all.

## [1.0.0] — 2026-11-19

**A local-first markdown notebook that a person and their agents share, with every writer visible.**

The three properties the release stands on: the notes are really stored (IndexedDB first,
`localStorage` as the stated fallback), an agent cannot see a note it was not given (`404`, never
`403`), and nothing happens silently — every write carries an author, every version is kept, and any
version restores in one click.

What is in it, and how it was proved:

- **An agent writes into the note, and the text it wrote is marked.** Agent spans come from the
  server, so the band travels with the characters: a flat 16 % fill with a hard 3px rule, translated
  with the text rather than scrolled in a second box, and re-derived when new ranges arrive with new
  text. `check:band-scroll` (on a note long enough to scroll), `check:attribution`.
- **Someone else in the note is visible.** Every writer's caret is drawn on the character it names,
  with a name on it and their selection tinted; presence lives in one row per note and actor, so a
  single serverless instance no longer holds the only copy. `check:caret-up`,
  `check:presence-shared`, `check:live-collab`.
- **A write by an agent reaches an open note in about a second,** because the presence poll carries
  the note's revision. Measured 810 ms token-to-pane; `check:collab` 2476 ms including the poll.
- **A person's save never deletes an agent's paragraph.** Five separate paths had supplied a wrong
  revision claim; every write now goes through one door that records why. `check:no-clobber`.
- **An agent cannot approve its own proposal,** and a switched-off note answers `404` on every agent
  route. `check:thread`, `check:thread-store`, `check:powers`, `check:url-token`.
- **The shell works offline** and the deploy carries the worker that makes it so. `check:offline`,
  `check:offline-live` against the deployed host.
- **The small things a person actually hits:** "+" hands the caret to the new note, a slow read never
  shows the note you just left, a save that never answers ends in a sentence instead of "Saving…", and
  a killed tab's uncommitted text comes back. `check:plus-focus`, `check:slow-load`,
  `check:hung-save`, `check:new-note`.

The gate at the tag: `npm run check:all` (27 checks) · `npm run verify` (72 unit files, 702 passed,
3 skipped, typecheck, build) · `npm run lint` (0 errors).

### Detailed log

### Added

- **Presence that every instance can see.** A caret lived in one serverless function's memory, so
  "where is the person typing" answered correctly only when the read landed on the same warm process
  as the write. Measured on production: a caret announced through `/api/agent/notes/:id/presence` was
  present on that route and absent through `/api/notes/:id/presence`, for the same person on the same
  note in the same second. Presence now lives in one row per (note, actor) in Postgres (migration
  `022_note_presence`), pruned on every heartbeat and capped at eight actors per note, and it falls
  back to the old in-memory store when the database refuses — a caret is never worth a failed
  request. `npm run check:presence-shared` starts two API processes, announces to the first and reads
  from the second: red before the table existed, green after.

- **Another writer's caret, drawn inside the note.** The agent presence route has always accepted
  `from`/`to`, and nothing on the page rendered it: collaboration was a name in a bar beside the
  editor. The band's mirror now paints each other writer's caret on the character it names — a 2px
  line under a small label — and tints the range they have selected. `check:live-collab` drives it on
  the deployed app with a real token.

### Fixed

- **An agent's write reaches an open note in under a second.** The editor's presence poll
  (`/api/agent/notes/:id/presence`) answered presence only, so the open pane never learned the text
  had moved and needed a reload. The note's revision rides along with the poll now: measured 810 ms
  from a token's `PATCH` to the words in the pane, band included.
- **The band is translated with the text instead of scrolled in a second box.** Two scroll containers
  clamp at different heights and each event lands a frame late, which read as the band bouncing.

- **An agent's mark now follows the note when it is long enough to scroll.** The band is painted in a
  backdrop that mirrors the editor, and on a long note the two boxes disagreed: the editor is an
  inline element, so its wrapper was 6px taller and the mirror could only scroll to 186 where the
  text sat at 192 — the band was permanently 6px low and no scroll event could close the gap. Worse,
  the mirror followed the editor only on `scroll`, so opening a note that scrolls to the caret drew
  the band at scrollTop 0 while the text was at 192: measured on production, the whole mark sat below
  the fold while the paragraph was on screen. The editor is now `block` (the two boxes are the same
  box) and the mirror syncs after every render and on the next frame. `npm run check:band-scroll`
  drives both: 14 checks on a note long enough to scroll, red on the previous build, green after.

### Removed

- **The "Shared" section, and `folder` as something a person can write.** Notes carry a `folder`
  label that the browser had no control to set and no grouping that used it, so the section could
  only ever appear for notes filed by a script. What the sidebar groups by is authorship — mine, an
  agent's, both — and that is what it now says, without a heading that promises a feature nothing
  can reach. `PATCH /api/notes/:id` no longer accepts `folder`; an agent's notes keep their `agent`
  label, which is stored and shown nowhere.

### Added

- **`npm run check:offline-live` asks the deployed site, not a local preview.** `check:offline`
  proves the worker a build wrote is correct; it cannot tell you whether the deployment carries that
  worker. This one reads `/sw.js` from the host, waits for the worker to take control, inspects what
  it cached, cuts the network and reloads — 10 checks, against `OFFLINE_LIVE_BASE` (default
  `https://canonote.vercel.app`).
- **A token's row says when it was last used** — "used 3 min ago" or "never used", then the expiry.
  `last_used_at` was already recorded on every authenticated call but never shown, so a token nothing
  had used looked exactly like one in active use (`check:token-used`).

### Fixed

- **The deploy carries the worker it needs.** `scripts/vercel-deploy.mjs` uploads an allowlist of
  build inputs, and `scripts/build-sw.mjs` was not on it — so `npm run build` failed on Vercel with
  `Cannot find module '/vercel/path1/scripts/build-sw.mjs'` and the offline shell could never reach
  production. The upload is now 194 files, 3 inline, and the build finishes.
- **Pressing "+" hands the caret to the new note.** Focus stayed on the button, so a person who kept
  typing typed into the button: every space re-activated it and made another blank note. The caret now
  moves at the click, a second press while a create is in flight is ignored, and while the note is
  being made the pane is read-only and says "Creating note…" rather than accepting text a later load
  would repaint away (`check:plus-focus`).
- **The note you left no longer flashes back after "+".** A read already in flight for the outgoing
  note answered into the emptied pane, so its text reappeared for about half a second. A transition
  now invalidates reads that started before it (`check:new-note`).
- **An empty stored note is not "the pane is behind".** A load could discard words typed into a note
  as it was created, because the server's empty body counted as newer.
- **The first note a new account writes is saved.** The empty pane a signed-in person sees is a
  placeholder, not a row, and nothing created it: every save answered 404 while the local list
  looked fine, and the text was gone on the next load. The first content now creates the note and
  the pane adopts its id (`check:first-note`).
- **Text typed while another note loads is no longer dropped.** The guard compared the target id
  against the id captured by the same render — a tautology — so the protection never ran.
- **The per-note agent switch answers a mouse.** It sits in a tooltip inside a
  `pointer-events-none` overlay that only re-enabled direct button children; clicks went to the
  row underneath. Keyboard tests passed because focus does not care about pointer-events.
- **A revoked token leaves the list**, instead of sitting there looking usable; its history stays
  in `agent_connection_events`.
- **Deleting a note can fail visibly** — a refused delete no longer removes the local copy and
  reports nothing.
- **A save has a deadline** (15 s) so one hung request cannot stall the serial save queue forever —
  and the deadline is reported. A failed save used to be retried every 500 ms by the autosave
  effect (a failed save changes state, which changes the callback, which schedules another), and
  the footer stayed on "Saving…" through all of it. It now says so once, keeps saying it
  ("Save failed · Retry") for as long as the draft is unsaved, and retries only when asked.
- **A new note no longer inherits the previous one's text.** Two causes: an empty server answer
  counted as a prefix of everything in the "pane is ahead" check, and the create round trip left
  the old text on screen. The pane is blanked the moment "new note" is pressed, nothing may write
  content into it until the new id arrives, and text typed in that window is saved under the new
  note rather than lost.
- **Switching notes shows the note you switched to.** A switch wrote one note's body under
  another note's id on the local flush, so the store could answer a load with the previous note's
  text — and the "already loaded" skip could leave the pane blank. The pane now clears before the
  load, and every flush checks which note the text belongs to.
- **A note created while a search filter is active is visible**: pressing "new note" clears the
  filter instead of leaving the note hidden behind a query that matches nothing.
- **Split view opens on an existing note** rather than creating a blank row every time it opens.

### Security

- `shared_notes` was readable with the public browser key (a policy with no `TO` clause). The
  policy is dropped and reads are scoped to the owner (019). The table is empty, so nothing leaked.
- A token with no owner listed every note in the database. Now 403 before the query.
- `/api/notes` no longer echoes Postgres messages in a 500.
- `agent_connections` accepts no direct writes from the browser role, so the TTL ceiling and the
  connection cap are no longer advisory (020).
- One CORS policy for both APIs (`api/_lib/cors.js`); an origin that is not allowed gets no header
  instead of another origin.

### Changed

- **The product has no brand colour.** Ink blue was rejected the day it shipped ("the blue accent is
  just terrible… just keep it grey", Ves, 2026-11-08), so the landing page, the app and `/demo` are now
  achromatic: `--accent-*` is a grey ramp, the one filled control is near-white on dark, and every
  text pair still clears 4.5:1. A script checks the rendered pages for chroma and reports zero.
- **The landing page starts at the left edge, not in the middle.** `.wrap` is left-anchored with a
  clamped gutter instead of a centred 1080px container, the headline is one colour (the second line
  used to be grey and read as disabled), the nav no longer repeats the hero button, and the two
  secondary actions are text links rather than a row of three equal boxes.
- **The hero shows the suggestion, not the toolbar.** The old screenshot led with a 20-icon toolbar
  and half-empty canvas; the figure is now the `/demo` page, where the agent's edit and its
  Accept/Decline sit in one frame — the thing being sold, at a glance.

### Added

- **Hover help, three tabs, and headings in the palette.**
  Every control now explains itself on hover and on focus, in one grey line instead
  of the browser's native `title` — which never appears for a disabled button, the
  one place the reason matters ("Copy all content — the note is empty"). It is one
  `Tooltip` component behind a portal, so no scroll container can clip it. The
  Helper View lost its Contents tab: it repeated the headings on screen, and
  jumping to a heading now happens in Ctrl+K with the commands and notes.
  `npm run check:ux` proves all three against the live site.
- **Agents moved into the Helper View, and issuing a token is one press.**
  The old panel asked for a name, an expiry from a dropdown, an "Issue delegated
  token" click — and then a second field to paste a token into and a third button to
  save it, on top of a card, a connections card and a "current note" card. Five
  controls and three surfaces for one decision. Agents are now a fourth tab in the
  Helper View ("Agent"): a name, already remembered, and **Create token**. The token
  appears once with Copy, thirty days, fixed scopes, and the connections list under
  it revokes. The per-note switch stays where it already was — the eye in the
  sidebar. `CollaborationPanel` and `useCollaborationUI` are gone.
- **Password reset works, and the sign-in screen is grey.**
  Three separate faults: Supabase's Site URL was `http://localhost:3000`, so every
  recovery mail pointed at a machine that is not there; the app asked for
  `{origin}/reset-password`, a route the build has never had; and the recovery link
  signs the browser in as a side effect, so the form never appeared and the notebook
  opened instead. Site URL and the redirect allowlist are now the live domain,
  `/reset-password` rewrites to the app for links already in inboxes, and the app
  reads `type=recovery` before the admin client swallows the hash. After the new
  password is set the recovery session ends, so the new password is proven on the
  form. `scripts/live-reset-proof.mjs` asks Supabase for the same link it would mail
  and walks it in a browser: 6/6. The sign-in card lost the sky-blue button and the
  navy `slate` fill for a white button on neutral grey.
- **The auth debug subsystem is gone.** Deleted: `api/auth/log.js`, `api/auth/lookup.js`,
  `api/_lib/auth-log-handler.js`, `api/_lib/auth-lookup-handler.js`, `src/utils/authDebugLogger.js`
  and its test — 692 lines of diagnostics that no component called. `useAuth` no longer logs events
  or exports the four download/clear helpers. `AGENT_API_TOKEN` and the delegated/first-party paths
  to the agent API are untouched; nobody has lost a way in.
  `AUTH_DIAGNOSTICS_ENABLED`, `AUTH_DEBUG_LOGGING_ENABLED` and `COLLAB_FORCE_MEMORY` were removed from
  `SUPABASE_SETUP.md`: `/api/auth/lookup` was the only reader of the first.
- **`npm run check:live-app` drives the deployed notebook in a real browser.** No account, no mocks:
  the editor opens, the footer says where the note is stored, a note is created and typed into, and
  after a reload the text is still there and the row carries the title from the markdown. The demo
  is checked as the static illustration it is. First run against production: PASS. Writing it
  corrected two assumptions of mine — the demo has no editor, and content after a reload arrives
  asynchronously, so a single sample reads empty.
- **`npm run check:live` checks the deployed site the way a stranger meets it.** Landing, notebook and
  demo answer 200; `/api/notes` refuses an anonymous caller with 401; `/api/agent` returns its
  manifest. Anything that should work and does not makes it exit 1, and a database that is not
  configured says which two variables to set. With `AGENT_KEY` and `NOTE_ID` it also proves the
  agent half against production.
- **The comment/suggestion overlay is gone — the second review workflow that nobody needed.**
  Deleted: `api/collaboration.js`, `api/_lib/collaboration-handler.js` (1,235 lines), its test file,
  the `collab:read` / `collab:write` scopes, and `AI_COLLABORATION_ARCHITECTURE.md` (721 lines).
  The panel went from 1,189 to 450 lines and now holds only what the agent story needs: its name,
  the token that connects it, the connections you can revoke, and the note in front of you.
  An agent already writes under its own name, its edits already land in history, and any version
  already restores in one click — a proposal queue on top of that was more surface, not more safety.
  The panel also stopped taking six props it never used.
- **The end-to-end suite is honest again, and it found three real defects.**
  - The helper tabs' selected label (`text-accent-300` on a mid-grey chip) and the command
    palette's selected row failed WCAG AA contrast; both now use the text colour the rest of the
    UI uses, and the palette's category line steps up when its row is selected.
  - The note row's floating action cluster swallowed clicks meant for the row (`pointer-events`):
    the wrapper is now transparent to the pointer and only its buttons take one.
  - The agent-name field had no home after the AI panel was removed; it now sits at the top of the
    collaboration panel, where connections, attribution and presence all read from it.
  Stale specs that still drove the removed AI tab are updated or deleted (`ai-key.spec.js` is
  gone with the feature). Suite: 87 passing.
- **What a save attempt means now lives in one table.** `src/services/save-outcome.js` answers one
  question — given the server's status, what happened and what should the user be told — for saved,
  conflict, precondition, missing, offline and error. The save hook asks it instead of carrying four
  hand-written branches with their own wording, so a deleted note cannot be resurrected by a retry
  and every failure keeps the draft while saying so. Covered by 8 tests, including the 404 case.
- **The save path is now proven in a browser, not just in unit tests.** `scripts/check-save.mjs`
  types into the editor, waits for "Saved", reloads the page and asserts the text is still there.
  It passes.
- **An agent's edit can be put back in one click.** History already said who changed the note;
  each row older than the current version now has a **Restore** button. `POST /api/notes/:id/revert`
  with `{revision}` writes that version's text back as a **new** version guarded by the current one,
  so the agent's edit is still in history afterwards and the undo has an author too. A revision
  that is not in this note's history answers 404, a missing revision answers 400 naming the field,
  and a note the user cannot see is never touched.
- **One command proves the whole agent contract.** `npm run contract` boots the reference server,
  reads the keys it prints, and runs entering, writing against a second author, the per-note switch,
  presence and the Node-to-Rust conformance vectors in order. Five groups, one verdict.
- **An agent in your note now says so, and where it is.** `POST /api/agent/notes/:id/presence`
  takes `{mode, from, to}` and answers with the entry it stored; the browser polls
  `GET /api/notes/:id/presence` every three seconds while a note is open and shows `Rudi · writing`
  in the footer beside the other people. Same twelve-second life as a tab: an agent that stops
  heartbeating disappears without a goodbye. A note switched off for agents answers **404** here
  too, so presence cannot reveal a note that is switched off, and announcing a caret never touches
  a revision. Measured against the reference server: 103 B to announce, a hidden note answers 404
  in 24 B, and the entry is gone at 12.5 s. The Rust binary implements the same two routes, and
  the conformance run covers them.
- **You can see who else is in the note.** Two tabs on the same note now show each other in the
  footer: a name, and for an agent what it is doing (`Rudi · proposing`). Presence rides a
  BroadcastChannel, so it needs no server, no account and no network; it heartbeats every 4 s and
  expires after 12 s, which means a closed tab disappears on its own rather than hanging around.
  Messages are capped at 160 bytes and 10 per second, and the caret sent is always the latest one.
  Measured: two tabs see each other, and a killed tab is gone in 13 s.
- **One contract, two implementations, one test.** `scripts/conformance.mjs` boots the Node
  reference server and the Rust binary, walks both through the same 21 vectors, and compares status,
  JSON shape and response size. It found five real drifts on the first run: write fields
  (`body`/`ifRev` vs `content`/`ifRevision`), the per-note switch missing from the Rust build, a
  missing `tags` key, and error bodies without the pointer that tells an agent where to turn the
  notebook back on. All five are fixed; the Rust crate now lives in `rust/canonote-agent/`.
- **Request bodies are checked before they reach the database.** Every write route (agent create and
  update, connection creation, note create and update, collaboration enable, comment, suggest and
  accept) now runs its body through a valibot schema. A markdown field that arrives as an object, a
  flag sent as the string `"false"`, or a body over 2 MB answers `400 {"code":"invalid_body","field":"content"}`
  instead of being written. Unknown keys are dropped; missing ones answer `Missing <field>.`
- **The server is type-checked.** `npm run typecheck` runs `tsc` over `api/` with `checkJs`, and
  `npm run verify` chains typecheck, tests and build into one gate. First run found 15 real type
  errors, all now fixed.
- **History says who changed the note, not just that it changed.** `GET /api/notes/:id/history`
  returns every canonical save from `note_versions` (revision, time, author, size, lines added and
  removed) without shipping the bodies, and the History panel now lists those server entries above
  this browser's snapshots. An agent edit reads as *Agent · +12 −0 · 14:02* instead of being
  indistinguishable from your own typing.
- **One note can be switched off for agents.** The eye icon on each note (or
  `PATCH /api/notes/:id {"agentAccess": false}`) removes that note from every agent route: it
  disappears from lists, search and single reads, and writes to it fail. The answer is `404`, not
  `403` — an agent must not be able to tell a withheld note from one that does not exist. Stored as
  `notes.agent_access` (migration 015, default true, so nothing changed for existing notes), and no
  agent route can turn itself back on. `scripts/agent-access.mjs` proves the whole round trip.
- **`/demo` — an agent edit you can accept in ten seconds.** A static page with one real note and one
  real suggestion: Accept replaces the sentence and updates the "file on disk" pane, Decline leaves
  the note untouched and collapses the block to `Claude · edit declined`. No account, no Supabase, no
  setup. Linked from the landing page as "See an agent edit a note".
- **`--agent-*` colour tokens.** Amber is now a semantic colour, not a preference: it marks anything
  an agent wrote — suggestion blocks, the agent dot, agent labels — while the interface stays ink.

### Changed

- **Palette: ink blue instead of teal, and a separate agent colour.** Ves, on seeing it: "I don't like
  the green… choose something that is more slick." `--accent-*` is now a blue ramp (`#3b5bd9` fill);
  amber is reserved for agent-authored content so human and agent work are distinguishable at a
  glance without a legend. `BRAND.md` records the rule.
- **The note is set in a serif, on a 44rem measure.** 17px/1.85 in Newsreader, self-hosted (21-132 kB
  per face, no third-party request, works offline; OFL 1.1 — see `src/fonts/README.md`),
  works offline) instead of 15px monospace, centred rather than flush left. The editor is a page to
  read, not a buffer to inspect.
- **Agent suggestions look like writing, not a diff.** `Suggestion.jsx` renders each proposal as a
  tinted block with an amber rule, the agent's name and how long ago it arrived, the proposed text in
  serif italic, and labelled Accept / Decline buttons. Resolved suggestions collapse to one quiet
  line instead of keeping a full card.
- **Plainer words in the collaboration panel.** "AI Agent Collab" → "Working together", "Comment
  Edits" → "Suggested edits", plus a presence line: "You and Claude are editing this note — 1 edit is
  waiting for you".
- **Landing copy talks to people, not to developers.** Markdown is mentioned where it is a feature
  (export), not as the pitch; a note is "a plain file you own".
- **The site works under a subpath, not only at a domain root.** The landing page's own links are
  relative (`./app`, `./`) instead of absolute (`/app`, `/`), so a project-site build
  (`npm run build -- --base=/<repo>/`) keeps navigation inside the subpath instead of jumping to the
  domain root. Verified served at `/notes-editor/`: `/app` → 301 → `/app/`, CTA lands on
  `/notes-editor/app/`, editor mounted, zero failed requests.
- **Deploy plumbing, and a gate on the artifact.** `npm run deploy` ships the site with the project
  owner's Vercel token (authored by the owner, so a Hobby project promotes it instead of reporting
  *"Deployment was blocked"*), `npm run audit:artifact` fails the build if a `href`/`src` in the
  emitted HTML points outside `dist/` or if a promised route is missing, and `public/_redirects`
  carries the `/app` rewrite for hosts that read it. Audit of the current build: 3 HTML files,
  26 local references, 0 broken.
- **The notebook works on hosts without rewrite rules.** `vite build` now emits `dist/app/index.html`
  as well as `dist/app.html`, so `/app` resolves on a static host that only knows directory indexes
  (GitHub Pages, Cloudflare Pages, a bare nginx root) instead of depending on the `vercel.json`
  rewrite. Verified against `python3 -m http.server` with no rewrites: `/app` → `/app/` → 200,
  title `canonote`, editor mounted, no failed requests.
- **The product is called canonote.** Renamed from Notes Editor across the page title, the
  notebook shell, the auth screen, the OpenRouter attribution header, the package name and
  BRAND.md.
- **The public front end now sells what the product does.** The landing page was still the
  old "Write without the noise" marketing page — AI inline editing, a Notion feature table,
  BYOK — while the notebook had become a review-first markdown editor. It now leads with the
  agent-suggestion flow, shows a real screenshot of the notebook, and states the honest scope:
  the notebook needs no backend, and review uses the optional hosted layer.
- **A brighter accent.** The front end accent moves from `#0f766e` to `#14b8a6` with near-black
  labels (7.4:1 on the fill); hover steps to `#2dd4bf` (9.9:1 on the page background).
- **Shareable links look finished.** A generated 1200×630 social card (`public/og.png`) plus
  Open Graph and Twitter metadata, and `npm run shots` / `npm run og` regenerate the hero
  screenshot and the card from the running app.

### Security

- **No credential-shaped string ships in the source, and a gate holds it that way.** Three spec
  fixtures were `sk-or-v1-<64 hex>` strings — byte-for-byte the shape OpenRouter issues, so a secret
  scanner on a public repo would flag them and, worse, the history scrub's `--replace-text` rule
  rewrote them in the tree being *shipped* instead of only in history (the scrub's own dry-run caught
  it). The fixtures now carry a human-readable fake body
  (`sk-or-v1-test-fixture-not-a-real-credential`), which the app's redaction shapes still match, so
  every spec that exercises key hygiene proves exactly what it did before. `src/services/secret-shapes.js`
  holds the five high-confidence shapes and `src/services/secret-shapes.test.js` runs them over
  `src/`, `tests/`, `scripts/` and `api/` inside the unit gate — the same vocabulary the off-repo
  history scanner uses, so the two cannot drift apart on what a credential looks like.
- **Your OpenRouter key cannot leave the app by accident.** The key is the reader's own, and three
  paths can carry one out without anyone meaning to: a log line, a URL and an error payload — provider
  error bodies sometimes echo the credential they refused. Every string that is about to be logged or
  shown now goes through `src/services/ai-secrets.js`, which removes the exact secret and the shapes a
  key is written in (`sk-or-v1-…`, `sk-…`, an `Authorization` value), so a provider that says which key
  it refused can no longer put that key in the chat, the console or a notice. The app also stopped
  copying the deployment's env key into `localStorage` — the one place the read path migrates keys
  *out* of — and an error is logged as its shape (`describeKeySafeError`), never as the object.
  `tests/ai-key.spec.js` pins it in a real browser: a typed key lands in the tab's session storage, no
  key value is in `localStorage` under any key, and no key ever reaches the page.
- **The agent API takes its token from a header only.** `getBearerToken` used to fall back to
  `?token=` in the query string; it now reads `Authorization: Bearer` and `x-agent-token` and nothing
  else, and a request that carries only a query token is answered as unauthenticated. A URL is logged
  by every proxy it passes, kept in browser history and sent as `Referer`, so a credential that rides
  in one is a credential published. Documented in `API_CONTRACTS.md` and
  `AI_COLLABORATION_ARCHITECTURE.md`.

### Added

- **Every string the app shows is held to the tone standard, by a gate.** The standard was enforced
  over the notice catalog and nothing else, so the rest of the reader-facing copy — headings, empty
  states, help lines, confirmations, the labels a screen reader announces — was written where it was
  shown and reviewed by nobody. `src/services/copy-audit.js` reads every string a reader can see out of
  `src/` (JSX text, the attributes that carry copy, string literals, with comments stripped first) and
  holds it to four rules: no exclamation mark, no emoji, no blame or apology, and no failure that
  states no fact where the app is holding one. `src/services/copy-audit.test.js` runs it over the whole
  source inside the unit gate — 87 files, 765 strings, 0 violations — and it asserts what it read
  before it asserts that it passes, so a sweep that matched nothing cannot pass. `node
  scripts/audit-copy.mjs` prints the same inventory and violations as a report (`--all` prints every
  string).
- **Your notes can be a folder you pick.** Storage panel → _Use a folder for your notes_ (Chrome and
  Edge): the notebook opens a directory of your choice and every note becomes one real `.md` file in
  it, holding exactly the markdown the editor shows — so the drive you already sync carries the notes
  to your other machines and any other tool can read them. The notebook's own index (the list, the
  current note, the journal, the version history) lives in `.canonote.json` beside the notes and is
  rebuilt from the markdown if it is lost; a `.md` file you drop into the folder opens as a note, and a
  file you delete there is a note you deleted. The panel states the folder, offers to reconnect a
  folder the browser has forgotten, and can put the notebook back in the browser without moving or
  deleting a file. This is the seam's second adapter: `src/services/folder-storage.js`, with the
  semantics unit-tested against an in-memory driver and the real API path proven against a real
  directory in `tests/folder-store.spec.js`.
- **A keyboard path through the whole notebook, asserted.** `tests/keyboard.spec.js` drives the app
  the way someone without a mouse does: the landing page hands Tab to the call to action and Enter
  lands in the notebook, the editor is reachable by Tab, `Ctrl+B` bolds the line the caret is on, the
  helper panel's tabs are one tab stop moved by the arrow keys, every dialog keeps Tab to itself,
  Escape closes each of them and gives the caret back to the control that opened it, and a mouse click
  paints no focus ring while Tab does. Four of the seven specs failed against the previous code.
- **`useFocusTrap` is now the whole dialog contract, not half of it.** The hook used to trap Tab and
  nothing else. It now also moves focus into the dialog when it opens, returns it to the control that
  opened the dialog when it closes, and answers Escape from the document — one implementation for the
  export dialog, the keyboard-shortcuts sheet, Find & Replace, the command palette, the storage panel
  and the confirm/prompt dialogs. Their five separate Escape effects and the bespoke focus trap in
  `App.jsx` are gone, and `src/hooks/useFocusTrap.test.jsx` covers the four rules.
- **The helper panel's tablist follows the tabs pattern.** The selected tab is the only tab stop
  (roving `tabindex`), Left/Right/Home/End move between tabs and take focus with them, and the panel
  is a `role="tabpanel"` named by the tab that is showing. Before this, all four tabs were tab stops
  and the arrow keys did nothing.
- **An agent API quickstart you can copy and run: `AGENT_API.md`.** The differentiator is that an agent
  can write into the notebook, and until now the only way to learn how was to read `API_CONTRACTS.md`
  route by route. The new document is the task-shaped half — issue a key, make the first call, read and
  write notes, walk the read-modify-write loop that stops an agent from overwriting an edit somebody
  made while it was reading, the error table, and the limits — with `curl` examples and a Node script
  for the conflict loop. Every example is executed against the real handler by
  `src/api/agent-api-docs.test.js`, so a documented route or status the API does not answer fails the
  unit gate.

- **The agent's trail, readable: `GET /api/agent/audit`, and the notebook's own panel for it.** Every
  note an agent creates or edits has been recorded in `agent_audit_log` since the agent note routes
  landed, and nothing could read it: the table carried the actor and the note but not the user whose
  notebook the event belongs to, so the only read it could support was "every event from every user" —
  a leak, not a feature. Migration 014 adds that owner, the write records it, and the read is scoped by
  it, newest first, `limit` 100 by default and 200 at most. A token with no owner is answered `403`
  rather than an empty list, and a store that refuses the read is answered `500`, so "nothing has
  happened" is never stated as "nobody could look". In the notebook, _Agent activity_ (command palette)
  shows the trail as one line per event — what happened, to which note, by whom, when — and states
  honestly that a notebook with no account connected has no trail to read, without calling the server
  at all. `src/api/audit-log.test.js` drives the route and the module, `tests/agent-activity.spec.js`
  proves the local-mode state in a real browser, and the panel is in the accessibility sweep.

### Fixed

- **A note cannot come back shorter than it was saved.** Opening a note reads it and then writes back
  what it read, and those are two separate operations with nothing re-checking the store in between —
  so a save that landed while the read was in flight (the 1.5 s debounce is behind the keystroke) was
  newer than the text about to be written, and the load put the older, shorter text back. Seen in the
  folder store under parallel load as a `.md` file that came back a character or two short although it
  provably held the full text when the reload started. The load now re-reads the note immediately
  before writing and, if the store has moved on, writes nothing and adopts what the store holds now —
  pane and bookkeeping together, so the screen cannot end up on the older text either. The check is
  narrow on purpose: it applies only when the text being written is exactly the text that was read,
  because a pane edit that shortens a note and an explicit discard are writes the user asked for.
  `src/hooks/useNotePersistence.test.js` makes the window deterministic (a store that answers its first
  read late, with the value it held when the read was issued) and the first spec fails on the previous
  code.
- **The error page states the error it is holding.** It said "Something went wrong" and "An unexpected
  error occurred" while rendering the error's own message two lines below it, and its help line advised
  clearing your browser data — the store a local-first notebook keeps your notes in, which is advice
  that cannot be followed in the direction it was given. It now states what happened, labels the box as
  what the error said, and warns that clearing site data would delete the notes. The reload
  confirmations also stopped claiming unsaved changes "may be lost": the journal saves the tail before
  the page unloads, so they say so.
- **Two failures told the console and not the reader.** A refused clipboard in the export dialog and a
  blocked print window both ended in `console.warn`, so a click did nothing the reader could see. Each
  raises a notice now (`copyFailed`, `printBlocked`).
- **Copy that shouted, or that said nothing the app did not already know.** The export dialog's
  `Exported!` and `Copied to clipboard!` are the catalog's `exported` / `copied`; the collaboration
  panel's `Saved!` lost its exclamation mark and its "Failed to load collaboration data." now names what
  failed and the step; the shortcuts sheet stopped saying "Master the editor with these shortcuts" and
  labelling a tip "Pro tip"; the empty sidebar stopped saying "Create your first note to get started"
  next to a button that already says Create note; and the document the print dialog writes lost its
  emoji.
- **The agent API's own route list was incomplete.** `GET /api/agent` is the first call an agent makes —
  it returns the routes that exist — and it was missing two that the handler serves:
  `GET /api/agent` itself and `DELETE /api/agent/connections` (revoke every key at once). Both are in the
  list now, and `src/api/agent-api-docs.test.js` holds the advertised list and the documented list equal
  to each other, so a route cannot be served and undocumented again.
- **Two documents described the note revision wrongly, and one described a response field that is not
  sent.** `API_CONTRACTS.md` and `AI_COLLABORATION_ARCHITECTURE.md` showed `revision` as a
  `<sha256>`; it is the note's `version` column as a string (migration 010, bumped by a trigger on every
  write), which is what `ifRevision` is compared against. The same contract's `GET /api/agent/stats`
  example still carried a `users` array, which the handler deliberately stopped returning — the response
  is totals only. The `428` a write without a revision answers was missing from the agent `PATCH` error
  list.
- **A record a save had overtaken could be replayed over the note and truncate it.** The journal's
  write-ahead record is consumed by the content it holds, and the rule was "only when the text is
  exactly the same" — so a record the pane had already moved past stayed behind, and the next open
  replayed it. The replay decided whether a record was stale by comparing its timestamp with the list
  row's, and a record written after the row's timestamp was taken at its word: the note came back a few
  characters short. Two changes, both in `src/services/note-journal.js`: a commit consumes a record it
  has superseded (its text is a prefix of the committed text), and the replay refuses a record whose
  text the note already holds *and more of*, which the store's own content settles — the timestamp
  cannot.
- **One typed text, one note, one file.** In the folder store, a save that overlapped the orphan scan
  could leave the notebook holding two notes for one text — two sidebar rows with the same title, one
  `.md` file empty and a second (`alpha-2.md`) carrying the text. The adapter mutated its shared
  bookkeeping across `await`s with nothing serializing the operations, so the scan read a file the save
  had just written but not yet recorded and adopted it as a second note; the next save then saw its own
  name as taken and moved the note to `-2`. Every operation now runs one at a time and a save records
  its file name before the file lands. Found on the way: a name was chosen from the sidecar alone, so a
  `.md` file dropped into the folder while the notebook was open was overwritten by the next note with
  the same title — names are now checked against the folder itself, which is the truth.
- **A note could be emptied by a pane that had not loaded it.** In the folder store, opening the notebook
  and clicking a note could leave the note's own `.md` file at 0 bytes — and write empty `untitled.md`
  files beside the user's notes. Two writes did it: the unload flush committed whatever the pane was
  showing for whatever note was current, and a superseded content load committed the live pane text back
  for its target note. Both now write only text the store does not already hold, and never a blank pane
  over a note whose stored text is not blank. `tests/folder-store.spec.js` asserts that a note the app
  opens comes back byte for byte.
- **The agent API answered its own client errors as server errors.** Issuing a delegated key with an
  unusable scope, or with an expiry in the past or beyond the maximum lifetime, came back as `500
  Internal error`; so did revoking a connection that is not there. A request the server cannot satisfy
  as written is now answered with its own status — `400` for a bad request, `429` when the user's active
  key limit is reached, `404` for a connection that is not theirs — and only a real fault is logged as
  one. `API_CONTRACTS.md` had been documenting the `400` while the code answered `500`.
- **A dialog that said `aria-modal="true"` let Tab walk out behind it.** Measured on the export
  dialog: ten Tab presses put focus on ten controls behind the scrim. It is trapped now.
- **The keyboard-shortcuts sheet did not answer Escape.** It lists `Esc — Close modal/menu` in its own
  table; Escape did nothing, focus never entered the dialog and Tab escaped it.
- **Closing a dialog dropped the caret on `<body>`.** After the command palette, Find & Replace or the
  export dialog closed, the next Tab started at the top of the page instead of continuing from the
  control that was used. Every dialog now returns focus to its opener, and the palette returns it to
  the note being written.
- **The command palette stole the caret back from its own tablist.** The AI panel's API-key field
  autofocused on mount, so arrow-keying to the AI tab moved focus out of the tablist and the arrow
  keys stopped working; the palette's input did the same to its own focus restore.
- **Every focus ring in the app answered a mouse click.** All 241 `focus:` ring, outline and border
  utilities across 25 files are `focus-visible:` now: the ring is for the keyboard, and a click no
  longer paints one.

- **One notice system, with the tone written down.** Every message an *event* raises now lives
  in `src/services/notices.js`, keyed and carrying its tone (success, info, warning, error) and its
  duration; a call site names a key instead of writing a sentence. (Static page copy — a heading, an
  empty state, a help line — lives where it is rendered and is held to the same standard by the copy
  audit, which arrived later and is recorded above.) The module documents the tone
  standard — at most two sentences (the fact, then the step), plain language with no exclamation
  marks or emoji, no blame and no apology, numbers rather than adjectives, and a next step that can
  actually help on every error — and `src/services/notices.test.js` enforces all of it over the whole
  catalog, including the entries whose text is built from counts. Two further tests read the source:
  a notice call may name a key and never prose, every key named exists, and no entry is copy nobody
  shows.
- **One set of states for all four helper panels.** Contents, AI, History and Tags each carried their
  own header row, empty wording and type sizes, and two of them had no loading and no error state at
  all. They now render through `src/components/HelperPanel.jsx` (`PanelHeader`, `PanelEmpty`,
  `PanelLoading`, `PanelError`), in the shapes `BRAND.md` already required — an empty state is one
  line of text and an optional action, with no illustration and no oversized icon.
- **The History panel distinguishes "no versions" from "the store refused the read"**, asks the store
  the same question the status row asks when a read comes back empty, and re-reads when the save
  pipeline records a snapshot (`canonote:note-versions-changed`) so a panel that is open while you
  type does not state a count that has stopped being true.
- **The toolbar says what it is and keeps every control reachable.** Six named groups (Text
  formatting, Lists, Blocks, Notebook, Note actions, Panels), a tooltip on every control that names
  the shortcut it really answers to — strikethrough is `Cmd/Ctrl+Shift+S`, not the markdown it also
  accepts — with `aria-keyshortcuts` announcing it to assistive tech, and an overflow menu that holds
  the block controls whenever the bar cannot fit them. The bar measures itself instead of guessing
  from the window, so the decision survives the notes sidebar taking 208px of it.
- **The note list shows what a note is about.** Each row carries the note's second line
  (`previewFromMarkdown`, the same rule that derives the title, so no syntax leaks into the list) and
  a long title keeps its full text on hover instead of being cut at the row's two-line clamp.
- **Selecting several notes and deleting them in one action.** _Select notes_ turns the list into a
  selection mode: a row toggles its selection instead of opening, _Select all_ acts on the rows on
  screen, Escape leaves the mode, and _Delete_ removes the whole selection through one delete path
  (`useNotes.deleteNotes`) — one cache write, one broadcast, and the content, the journal record and
  the version history of every note in it.
- **The caret's place in the note**, in the status row next to the word count: `Ln 3, Col 10`, counted
  in the units a textarea reports so the number agrees with the selection it describes, and shown only
  once the editor has reported a caret (a position behind a hover is not a position).
- **IndexedDB as the notebook's store.** The notes moved off Web Storage onto IndexedDB (hundreds of
  megabytes instead of a few, and real transactions), behind the same seam — the app never learns
  which store it is on. Web Storage stays as the fallback for a browser with no IndexedDB, and a
  notebook left there by an earlier session is moved into the store on the next open. The unload flush
  writes its journal record to Web Storage synchronously, because an unload cannot wait for an
  asynchronous store.
- A **name you choose for your agent** — shown on agent notes, note rows, suggestions and connections
  (AI settings → Agent name). Stored locally, defaulting to the neutral `Agent`; no assistant's name is
  built in.
- **Import** — markdown files (`.md` / `.markdown` / `.txt`) and ZIPs the app itself exports, as the
  missing half of export. Exporter frontmatter is parsed back out and re-imported without
  duplicating a notebook; a foreign file without frontmatter is treated as body text, never an
  error.
- A **storage panel** (command palette → _Storage health_): where the notes live, how much space they
  take and when the last backup was — with **back up now**, **export all notes**, and **restore the
  latest backup** on the same surface as the numbers that make them necessary.
- **Rotating local backups.** A whole-notebook snapshot, written on demand and once a day on its own
  when the newest has gone stale; the newest three are kept in the browser and the older ones are
  dropped. Restoring only adds the notes the notebook no longer has, so it can never overwrite newer
  work. Covered by unit tests for the rotation and an end-to-end spec that loses the store and reads
  the note back.
- A **journal that survives a killed tab**: a keystroke writes a record before the note it belongs to
  is committed, and opening the notebook replays anything a tab left behind — the note is listed with
  its text instead of silently gone.
- A `NotebookStore` storage seam, with the browser-local implementation as the first adapter, so the
  storage shape can change without the app changing.
- An end-to-end spec that types into the app as it opens, without creating a note first.
- An edge sweep over the states a notebook loses work in: an empty notebook, non-ASCII text, a
  large note, a corrupt notes cache with orphan content to recover, a second tab on the same
  device, and no internet.
- Coverage floors enforced by `npm run test:coverage` for the layers the unit suite owns —
  `src/utils`, `src/services`, `src/hooks` and `api/_lib`.
- A standing product roadmap ([ROADMAP.md](./ROADMAP.md)) and a decision record
  ([DECISIONS.md](./DECISIONS.md)).
- Release documents: `CONTRIBUTING.md`, `SECURITY.md`, issue templates, this changelog.
- An accessibility sweep (`tests/a11y.spec.js`): axe over the marketing page and every notebook
  surface — empty, with a note, no search results, helper panel, AI settings, storage panel, export,
  find & replace, command palette, keyboard shortcuts, and the narrow toolbar with its overflow menu
  open — plus a keyboard focus-ring check. Green, with the fixes below.
- A performance budget ([PERFORMANCE.md](./PERFORMANCE.md)), enforced by the gates. `npm run check:bundle`
  runs after the build and fails when a surface's first load, the largest JS chunk, or the total
  JS + CSS in `dist/` exceeds its budget; `tests/performance.spec.js` (inside `npm test`) fails when the
  editor takes more than five seconds to open, or a keystroke more than 250 ms to land in a large note.
  Measured on the release build: 148 kB gzip for the notebook's first load, an 88 kB largest chunk,
  ~2.5 s to a usable editor and a 32 ms median keystroke.

- **Four messages in the app broke the tone the product promises.** "Text improved successfully!"
  shouted and said nothing, "Copied!" carried an exclamation mark, and "Could not copy the conflicted
  draft." and "Could not save your local draft." told the reader what failed without a step that
  could help. They now read "Improved the selected text.", "Copied", "Could not copy the conflicted
  draft. Select it in the editor and copy it instead." and "Could not save your local draft. Try
  again." — and the standard they were measured against is enforced by the test suite from now on, so
  the next message written inline fails the build instead of shipping.
- **The History panel claimed "No versions saved yet" when it could not read them.** A store read the
  browser refused came back as an empty list, so a blocked browser, a full store and a note with no
  history were the same screen — and the app stated one as the others. A failed read now says what
  happened with the step that fits it, and the panel only shows its empty state when the store is
  readable.
- **An open History panel showed "0 versions saved" over versions that existed.** The list was read
  when the tab was opened and never again. It is re-read when the save pipeline records a snapshot.
- **A History read for one note could land over another's.** Switching notes quickly leaves two reads
  in flight, and the slower one used to win; each read now carries a token and a stale one is dropped.
- **The Tags panel's section headings skipped a level.** `Tags (n)` and `References (n)` were `<h3>`
  directly under the page's `<h1>`, which axe reports as a moderate `heading-order` violation. They
  are `<h2>` now — and the four helper panels are each swept by the accessibility suite, which had
  only ever analysed whichever tab the app happened to open on.
- **The toolbar clipped its last controls, and hid five of them outright.** At 1280 with the notes
  sidebar open — the layout the app opens in — the bar's own content ran 75px past the scroller, so
  *Horizontal rule* and *Table* sat underneath the right-hand cluster: unclickable, and with the
  scrollbar hidden there was nothing to suggest they could be scrolled to. Below `md` the same five
  were hidden with no way to reach them at all. The bar now measures its own row and hands the block
  controls to the overflow menu whenever they do not fit, so nothing is clipped and nothing is
  unreachable, at any width.
- **Copy and Clear all content were dead ends on an empty note.** *Copy all content* announced a copy
  of nothing and *Clear all content* asked for confirmation before clearing nothing. Both are now
  disabled while the note has no text, with the reason in the tooltip; *Export note* stays enabled,
  because an empty note is still a note and the file is the point.
- **A menu that portals to the body left the page's landmarks.** The heading dropdown, the theme
  picker and the new overflow menu render outside `<main>` — so their content sat in no landmark at
  all and landmark navigation could not reach it. Each popup now carries a named `region`, which is
  what the narrow-width accessibility sweep caught.
- **Deleting a note left its version history behind.** The content and the journal record went with
  the note; the `note-versions:<id>` snapshots did not, so a deleted note kept its text in the store
  for good — unreachable (the history panel is opened from the note) but still there. A delete now
  removes the content, the record and the history together.
- **The selection bubble menu never opened, and the editor never reported the caret.** One subscription
  read the textarea's own `select`/`keyup`/`mouseup`/`input` events and fed three things: the bubble
  menu, the toolbar's active-format states, and the status row. It subscribed once at mount — but the
  editor element does not exist at the first commit, because the app renders "Opening your workspace…"
  until storage is open and auth has settled, so the effect returned before it ever listened and never
  ran again. It now attaches the first time the textarea is really there (and again if it is ever
  replaced). Verified against the deployed app, which showed no bubble menu on a selection;
  `tests/editor-chrome.spec.js` covers the menu and the readout.
- **Typing twice in a row could revert the editor to the previous text.** A content load read the
  store while the typing was still inside the 1.5 s save debounce, and the load's result was applied
  afterwards without asking whether the editor still showed what had been read — with the store now
  asynchronous that window is real, and the editor came back with the older text while the sidebar row
  already carried the new title (so a save of the new text existed and the screen disagreed with it).
  Two things changed: a load never lands on top of text the store does not hold yet, and a leftover
  journal record is no longer preferred over content the store already holds (in the local notebook
  there is no revision to compare a record against, so the record can only be older — the replay on
  open, with its own timestamp rule, is what restores an uncommitted draft). Covered by a new edge
  spec, `a load in flight never reverts text typed while it was reading`, which fails on the previous
  code.
- **The notebook claimed notes were stored while the browser was refusing every write.** With site
  data blocked (or private browsing), the status row said "Stored in this browser", every save failed
  with "Failed to save note. Please retry." — an instruction the browser would refuse again — and the
  text was gone after a reload, said once per keystroke. The app now asks the browser whether it will
  store anything: the status row states the failure instead of claiming storage it does not have, and
  the message names the cause with a step that can help (allow site data, or leave private browsing)
  or says the store is full. The failure is reported once, not once per keystroke.
- **Every modal and secondary label was styled by a dead `dark:` variant.** The Tailwind dark
  variant was keyed to `[data-theme="dark"]`, an attribute no theme sets, so the export dialog
  rendered white in the dark app and the command palette's key chips rendered near-white.
- **Muted text missed the 4.5:1 contrast floor.** Secondary labels, timestamps and empty-state
  copy used `gray-500` (3.2:1 on the app surfaces); they now use `gray-400` (5.8:1). Icons, borders
  and disabled controls keep `gray-500`.
- **The landing page's primary button.** The nav links out-specified the button's white label
  (2.07:1), and hover set the fill to a grey text token instead of the accent.
- **The note list row was a button containing buttons**, so the pin and delete controls were
  unreachable by keyboard; the row is now a real button with the two actions as siblings.
- **The AI settings panel was unlabelled and out of order.** Its Model dropdown had a `<label>`
  that was never associated with the select (no accessible name), and the panel's `h3` followed the
  page's only `h2`. The label is associated, the title is an `h2`, and the panel is now one of the
  surfaces `tests/a11y.spec.js` sweeps — the settings were previously unreachable without an API key,
  so nothing had ever checked them.

- **Note loss on the note the app opens on.** The editor opens on a placeholder note that was not
  in the note list and had no stored current-note id. Text typed there was written only on the
  `pagehide` flush, so a reload lost it, and clicking the note's row afterwards left the editor
  empty. The placeholder now materialises into a real, saved note on the first keystroke, and
  selecting any list row loads that note's content.
- **A deleted note could be re-listed by a save that was already in flight.** The in-session
  deleted-id guard existed but was never armed, so a late rename could put the row back in the
  sidebar. It is now populated when the delete lands.
- **The toolbar's storage chip read as a control that did nothing.** A bordered, filled, rounded box
  labelled `Local` sat at the end of a row of real buttons, with no click and no hover state of its
  own. Where the notes live is a fact, so it is now plain status text in the row under the editor
  ("Stored in this browser", `src/components/StorageMode.jsx`), and the toolbar shows an account
  cluster only when there is an account — and a sign-out button to go with it.

### Changed

- **Brand and design.** A cool-ink palette with a teal accent, one type family for the UI
  (hierarchy from size and weight), and a monospaced face (`JetBrains Mono`) for the markdown
  surface. The landing page now styles from repo-root `site.css` — the Tailwind CDN is gone.
- **Two surfaces, one build.** The public front end owns `/`; the notebook owns `/app`. A visitor
  no longer lands inside the tool.
- **Local-first by default.** The app asks a configured backend once and falls back to the local
  notebook when nothing answers, instead of gating every visitor behind a sign-in that cannot
  succeed.

### Removed

- TipTap/ProseMirror and its extensions — slash commands, tag and wikilink autocomplete popups.
- HTML↔markdown conversion on every keystroke, and the parallel HTML representation of each note.
- The silent cache/orphan fallback that made saving feel uncertain.
- Various background sources and debug scripts no longer referenced from the product.
