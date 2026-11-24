-- 022_note_presence.sql — a caret that survives the function that received it.
--
-- Presence used to live in one serverless function's memory. Measured on
-- production 2026-11-19: a caret announced through /api/agent/notes/:id/presence
-- was present on that route and absent through /api/notes/:id/presence, for the
-- same person on the same note in the same second — the two functions share
-- nothing. The same split happens between two warm instances of one function,
-- which is a coin flip on every poll.
--
-- This table is that shared memory. It is not authoritative for anything: a row
-- is a heartbeat carrying its own timestamp, filtered on read, with no note text,
-- no history and no access flag. Losing it costs a caret, never a note.

create table if not exists public.note_presence (
  user_id  uuid        not null references auth.users(id) on delete cascade,
  note_id  text        not null,
  actor_id text        not null,
  kind     text        not null check (kind in ('agent', 'person')),
  name     text        not null,
  mode     text,
  from_pos integer,
  to_pos   integer,
  at       timestamptz not null default now(),
  primary key (user_id, note_id, actor_id)
);

-- Every read is "this note, newer than the TTL", and every prune is "older than
-- the TTL", so the age is the only column worth an index besides the key.
create index if not exists note_presence_at_idx on public.note_presence (at);

alter table public.note_presence enable row level security;

-- No policies on purpose: a browser never reads or writes this table. The API
-- does, with the service key, only after it has authenticated the caller and
-- checked the note. A policy here would be a second, weaker copy of that check.
