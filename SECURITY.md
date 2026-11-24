# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Report it privately through GitHub's [private vulnerability
reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository (the **Security** tab → **Report a vulnerability**). That channel is private
between you and the maintainer and lets us ship a fix before anything is public.

Please include:

- what the issue is and where it lives (file, route, or UI surface),
- the steps to reproduce it,
- what an attacker gets out of it,
- and any proof-of-concept you can share.

You will get an acknowledgement, an assessment, and credit in the fix if you want it.

## Supported versions

The project is pre-1.0 in spirit: only the tip of `main` is supported. Fixes land on `main`; there
are no maintained back-branches.

## Scope

canonote runs in two shapes, and the threat model differs for each.

**Local notebook (the default, no backend).** Everything happens in the browser. Notes live in that
browser's storage; there is no server to attack and no network path between two users. The relevant
risks are local and self-inflicted (a shared machine profile, browser extensions, and any file you
import). Imported markdown is treated as text and rendered as text — it is never executed.

**Hosted layer (optional, only if you deploy it).** This is where credentials exist, and it is
where real reports are expected:

- authentication and session handling (`api/_lib/authz.js`, `api/auth/*`),
- the agent API and delegated token lifecycle — token creation, scopes, expiry and revocation
  (`api/_lib/agent-handler.js`, `POST /api/agent/connections`),
- authorization on note-scoped routes — a token or user must not reach a note it was not granted,
- SQL and storage access through the repository layer (`api/_lib/notes-repository.js`),
- and anything that could leak a secret: keys, tokens, or note content in logs.

Deploying the hosted layer is **your** responsibility: it needs your own Postgres/Supabase project
and service credentials. In its default configuration with no credentials configured, the API routes
answer `503` and grant nothing.

## What is not a vulnerability here

- Notes being readable by anyone with access to a device's browser profile, when the app is used as
  a local notebook. There is no account and no encryption at rest — this is by design and is stated
  in the README.
- Anything requiring a malicious fork of this repository, or a build you compiled yourself with
  your own modifications.

## Handling secrets in this project

- Never commit credentials, tokens or personal note exports. They are not in the repository and must
  not be added to it.
- The hosted layer reads its credentials from environment variables (`SUPABASE_URL`,
  `SUPABASE_SERVICE_KEY`) and never from the repository.
- Agent tokens are shown once at creation and stored hashed where the hosted layer is used. A token
  belongs in an `Authorization` header, not in a query string.
