#!/usr/bin/env node
/**
 * What an agent token can and cannot do, against production.
 *
 * Everything here is a promise the app makes in its own settings panel: a token
 * belongs to one person, can be revoked, cannot mint or revoke other tokens, and
 * cannot reach a note that is switched off. This asks the live API instead of
 * trusting the code, and deletes the account it used.
 */
import { readSecret } from './lib/secrets.mjs';

const BASE = 'https://canonote.vercel.app';
const SUPABASE = 'https://vcplldetvuezauzwyrkh.supabase.co';
const SERVICE = readSecret('supabase-service-key', 'SUPABASE_SERVICE_KEY');
const PUBLIC = 'sb_publishable_qB1erd1_XW71j1dJmGi4Lw_-KfNyjQd';

let failures = 0;
const line = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(54)} ${detail}`);
};

const stamp = Date.now();
const email = `promi-powers-${stamp}@example.com`;
const password = `powers-${stamp}-aaaa`;

const api = async (url, { method = 'GET', body, headers = {} } = {}) => {
  const res = await fetch(url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

const user = await api(`${SUPABASE}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  body: { email, password, email_confirm: true },
});
const userId = user.json?.id;
const session = await api(`${SUPABASE}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: PUBLIC, Authorization: `Bearer ${PUBLIC}` },
  body: { email, password },
});
const jwt = session.json?.access_token;
const U = { Authorization: `Bearer ${jwt}` };

const issued = await api(`${BASE}/api/agent/connections`, {
  method: 'POST',
  headers: U,
  body: {
    agentLabel: 'Promi',
    scopes: ['notes:read', 'notes:write'],
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  },
});
const token = issued.json?.data?.token;
const connectionId = issued.json?.data?.id;
const A = { Authorization: `Bearer ${token}` };
line(Boolean(token), 'the person mints one token', connectionId || '');

try {
  const madeNote = await api(`${BASE}/api/notes`, {
    method: 'POST',
    headers: U,
    body: { content: 'A note with a switch.' },
  });
  const note = madeNote.json?.data;
  line(Boolean(note?.id), 'and has a note', note?.id || '');

  // A token cannot mint another token.
  const mint = await api(`${BASE}/api/agent/connections`, {
    method: 'POST',
    headers: A,
    body: { agentLabel: 'Second', scopes: ['notes:read'] },
  });
  line(mint.status === 403, 'an agent cannot mint a token', String(mint.status));

  // A token cannot revoke itself, or anything else.
  const revokeSelf = await api(`${BASE}/api/agent/connections/${connectionId}`, {
    method: 'DELETE',
    headers: A,
  });
  line(revokeSelf.status === 403, 'an agent cannot revoke a token', String(revokeSelf.status));

  // It cannot list the person's connections either.
  const list = await api(`${BASE}/api/agent/connections`, { headers: A });
  line(list.status === 403, 'an agent cannot list connections', String(list.status));

  // There is no route to delete a note.
  const del = await api(`${BASE}/api/agent/notes/${note.id}`, { method: 'DELETE', headers: A });
  line(del.status === 404 || del.status === 405, 'an agent cannot delete a note', String(del.status));

  // Hiding a note is the person's switch, not the agent's.
  const hide = await api(`${BASE}/api/agent/notes/${note.id}`, {
    method: 'PATCH',
    headers: A,
    body: { content: 'still writable', agentAccess: false },
  });
  const afterHide = await api(`${BASE}/api/notes/${note.id}`, { headers: U });
  line(
    afterHide.json?.data?.agentAccess !== false,
    'an agent cannot switch its own access',
    `PATCH ${hide.status}`
  );

  // The person switches it off: every agent route answers 404, never 403.
  const off = await api(`${BASE}/api/notes/${note.id}`, {
    method: 'PATCH',
    headers: U,
    body: { content: 'A note with a switch.', agentAccess: false, ifRevision: afterHide.json?.data?.revision },
  });
  line(off.status === 200, 'the person can switch a note off', String(off.status));
  const readHidden = await api(`${BASE}/api/agent/notes/${note.id}`, { headers: A });
  line(readHidden.status === 404, 'a hidden note answers 404', String(readHidden.status));
  const writeHidden = await api(`${BASE}/api/agent/notes/${note.id}`, {
    method: 'PATCH',
    headers: A,
    body: { content: 'should not land' },
  });
  line(writeHidden.status === 404, 'and cannot be written', String(writeHidden.status));

  // Revoking takes effect on the next call, with no cache to wait out.
  const revoke = await api(`${BASE}/api/agent/connections/${connectionId}`, {
    method: 'DELETE',
    headers: U,
  });
  line(revoke.status === 200, 'the person revokes the token', String(revoke.status));
  const afterRevoke = await api(`${BASE}/api/agent/notes`, { headers: A });
  line(afterRevoke.status === 401, 'the revoked token is dead at once', String(afterRevoke.status));

  // …and it disappears from the list the person reads, instead of sitting there
  // looking usable. Its history stays in agent_connection_events.
  const listed = await api(`${BASE}/api/agent/connections`, { headers: U });
  const stillListed = (listed.json?.data || []).some((item) => item.id === connectionId);
  line(!stillListed, 'and the revoked token is gone from the list', `${(listed.json?.data || []).length} left`);

  // Minting and revoking are recorded in agent_connection_events. They are not
  // shown anywhere in the app yet — the panel lists tokens, not their history.
  const events = await api(
    `${SUPABASE}/rest/v1/agent_connection_events?connection_id=eq.${connectionId}&select=action`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
  );
  const actions = (events.json || []).map((event) => event.action);
  line(
    actions.includes('issued') && actions.includes('revoked'),
    'minting and revoking are both recorded',
    [...new Set(actions)].join(',')
  );
} finally {
  await api(`${SUPABASE}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
}

console.log(failures === 0 ? '\nPASS  the agent stays inside its powers\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
