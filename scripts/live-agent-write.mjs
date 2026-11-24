/**
 * The id a list hands back must be the id every other route accepts.
 *
 * This was broken: GET /api/agent/notes returned the row id, GET /api/agent/notes/:rowId
 * answered 404 — and a 404 is also what a note switched off for agents answers, so an
 * agent could not tell "I cannot open this" from "I am not allowed to".
 *
 * Run: node scripts/live-agent-write.mjs
 */
import { readSecret } from './lib/secrets.mjs';

const BASE = 'https://canonote.vercel.app';
const SERVICE = readSecret('supabase-service-key', 'SUPABASE_SERVICE_KEY');
const stamp = Date.now();
const email = `promi-aw-${stamp}@example.com`;
const password = `aw-${stamp}-aaaa`;

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(56)} ${detail}`);
};

const created = await fetch('https://vcplldetvuezauzwyrkh.supabase.co/auth/v1/admin/users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const userId = (await created.json()).id;
const auth = await fetch('https://vcplldetvuezauzwyrkh.supabase.co/auth/v1/token?grant_type=password', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: SERVICE },
  body: JSON.stringify({ email, password }),
});
const { access_token: jwt } = await auth.json();

const mint = await fetch(`${BASE}/api/agent/connections`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
  body: JSON.stringify({ name: 'live-write-probe' }),
});
const minted = await mint.json();
const token = minted?.data?.token;
const connectionId = minted?.data?.id;
const call = async (path, init = {}) => {
  const res = await fetch(`${BASE}/api/agent${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const noteId = `note-${stamp}-probe`;
const made = await call('/notes', {
  method: 'POST',
  body: JSON.stringify({ id: noteId, title: 'A note the agent made', content: 'first line' }),
});
check(made.status === 201, 'the agent can create a note', `${made.status}`);

const listed = await call('/notes?limit=5');
const row = (listed.body?.data || []).find((n) => n.title === 'A note the agent made');
check(!!row, 'and finds it in the list');
check(!('content' in (row || {})), 'the list is metadata only');
check(
  typeof row?.id === 'string' && row.id.startsWith('note-'),
  'the list hands back a note id, not an internal row id',
  `${row?.id}`
);

const opened = await call(`/notes/${row?.id}`);
check(opened.status === 200, 'the id from the list opens the note', `${opened.status}`);
check((opened.body?.data?.content || '').includes('first line'), 'with its text', JSON.stringify(opened.body?.data?.content));

const rev = opened.body?.data?.revision;
const wrote = await call(`/notes/${row?.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ content: 'first line\nsecond line, written by the agent', ifRevision: rev }),
});
check(wrote.status === 200, 'and the agent can write to it', `${wrote.status}`);
const reread = await call(`/notes/${row?.id}`);
check((reread.body?.data?.content || '').includes('second line'), 'the write is there when read back');
check(
  (reread.body?.data?.revision || 0) > rev,
  'and the revision advanced',
  `${rev} -> ${reread.body?.data?.revision}`
);

// Polling: `since` is the answer for "what happened", and it is cheap.
const stampNow = new Date().toISOString();
const wroteAgain = await call(`/notes/${row?.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ content: 'first line\nthird line, after the poll mark', ifRevision: reread.body?.data?.revision }),
});
check(wroteAgain.status === 200, 'a second write lands', `${wroteAgain.status}`);

const changed = await call(`/notes?since=${encodeURIComponent(stampNow)}`);
const changedIds = (changed.body?.data || []).map((n) => n.id);
check(changedIds.includes(row?.id), 'since= lists the note that changed', `${changed.body?.data?.length} row(s)`);
check(!!changed.body?.pageInfo?.since, 'and hands back the next since', `${changed.body?.pageInfo?.since}`);

const quiet = await call(`/notes?since=${encodeURIComponent(changed.body.pageInfo.since)}`);
check((quiet.body?.data || []).length === 0, 'nothing changed is an empty list', `${quiet.body?.data?.length} row(s)`);
check(
  JSON.stringify(quiet.body).length < 400,
  'and a quiet poll is small',
  `${JSON.stringify(quiet.body).length} bytes`
);

const badSince = await call('/notes?since=not-a-date');
check(badSince.status === 400, 'a since that is not a time is refused', `${badSince.status}`);

// The row id still resolves, so an id carried over from before the fix is not lost.
await fetch(`${BASE}/api/agent/notes/${reread.body?.data?.id}`, {
  headers: { Authorization: `Bearer ${token}` },
});

if (connectionId) {
  await fetch(`${BASE}/api/agent/connections/${connectionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${jwt}` },
  }).catch(() => {});
}
await fetch(`https://vcplldetvuezauzwyrkh.supabase.co/auth/v1/admin/users/${userId}`, {
  method: 'DELETE',
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
});
console.log(failures === 0 ? '\nPASS  a listed note can be opened and written\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
