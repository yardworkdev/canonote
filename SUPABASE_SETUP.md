# Supabase setup — the optional hosted layer

The notebook is local-first and needs none of this. This guide covers the optional hosted layer the
repository carries: canonical note storage plus the agent and collaboration APIs. It is **not** part
of the default, and the project does not run it for you — it needs your own Supabase project and
server credentials. Without them the API answers `503` and the app runs as a local notebook.

If you do configure it, the client asks the backend once on startup and falls back to the local
notebook when nothing answers — credentials in a build are not a backend. See
[DECISIONS.md](./DECISIONS.md) § "A configured backend must answer, or it does not gate".

## 1. Create a project

Create a Supabase project and collect:

- the project URL
- the anon / public key
- the service-role key

## 2. Apply the migrations

Run the SQL files in `supabase/migrations/` in order:

- `001_initial_schema.sql` — notes table
- `002_ai_collaboration.sql` — comments, suggestions, activity
- `003_rudi_zone.sql` — legacy agent folder (the app now writes the neutral `agent` folder)
- `004_smart_links.sql`
- `005_agent_audit_log.sql`
- `006_agent_connections.sql` — delegated agent tokens
- `007_agent_collab_hardening.sql`
- `008_fix_live_notes_schema.sql`
- `009_hardening.sql`
- `010_notes_authoritative_state.sql` — the `version` column, its auto-increment trigger and
  `deleted_at` for soft deletes
- `011_lock_down_notes_rls.sql` — row-level security locked to authenticated users
- `012_canonical_note_history.sql`
- `013_note_history_retention.sql`
- `014_agent_audit_log_owner.sql` — the owner on the agent audit trail, which is what makes
  `GET /api/agent/audit` readable per user

Migrations are additive. Never modify an applied file — add `015_*.sql`.

## 3. Client environment (optional)

In `.env.local`:

```bash
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

Notes:

- With these set the app probes the backend once (`/auth/v1/health`); if it does not answer, the app
  stays a local notebook rather than showing a sign-in that cannot succeed.
- `VITE_AUTH_LOCAL_BYPASS=true` skips the sign-in form with a development user. Development only.
- (removed) `VITE_OPENROUTER_API_KEY` no longer exists: the notebook has no in-app AI chat.
  brought by the user (BYOK) and stored in the browser.

## 4. Server environment (for `api/*`)

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_KEY=<service-role-key>      # SUPABASE_SERVICE_ROLE_KEY is also accepted

# Optional
CORS_ALLOWLIST=https://your-app.example

# Legacy static agent tokens (prefer delegated connections, below)
AGENT_API_TOKEN=<token>
AGENT_API_TOKENS=<comma>,<separated>,<tokens>
AGENT_OWNER_USER_ID=<owner-uuid>
AGENT_MAX_CONNECTIONS_PER_USER=5
AGENT_MAX_CONNECTION_TTL_MS=15552000000
```

## 5. Auth providers

Enable the providers you plan to use in Supabase Auth. The API expects a Supabase user JWT as the
bearer token on `/api/notes` and on the human-only agent-connection routes.

## 6. Delegated agent connections (preferred)

1. Sign in as a real user.
2. `POST /api/agent/connections` — the plaintext token is returned once.
3. Call `/api/agent/*` with `Authorization: Bearer <token>`.

`AGENT_API_TOKEN` and friends remain a compatibility fallback; they should not be the default for new
integrations.

## 7. Verification checklist

1. `npm run dev` loads without Supabase initialization errors.
2. `GET /api/agent` returns the supported route list.
3. `POST /api/agent/connections` creates a delegated connection for an authenticated user.
4. `GET /api/agent/notes?limit=2` returns note data and pagination metadata.
5. `POST /api/collaboration/enable-note` succeeds for an authenticated user and an existing note.

## See also

- [AGENT_API.md](./AGENT_API.md) — the quickstart: get a key, call `/api/agent/*`, handle the conflicts
- [API_CONTRACTS.md](./API_CONTRACTS.md) — request/response shapes for `/api/notes`, `/api/agent/*`
  and `/api/collaboration/*`
- [AI_COLLABORATION_ARCHITECTURE.md](./AI_COLLABORATION_ARCHITECTURE.md) — the collaboration module
  in depth
