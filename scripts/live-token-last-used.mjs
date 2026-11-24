#!/usr/bin/env node
/**
 * A token's row must be able to say when it was last used.
 *
 * The panel is only as honest as the API behind it, so this asks the live API:
 * a fresh token says `lastUsedAt: null`, one call with it sets the time, and the
 * list the panel reads carries that time back. No UI involved — if this passes
 * and the rendering test passes, the row is telling the truth.
 */
import { readSecret } from './lib/secrets.mjs';

const BASE = 'https://canonote.vercel.app';
const SUPABASE = 'https://vcplldetvuezauzwyrkh.supabase.co';
const ANON = 'sb_publishable_qB1erd1_XW71j1dJmGi4Lw_-KfNyjQd';
const SERVICE = readSecret('supabase-service-key', 'SUPABASE_SERVICE_KEY');

const stamp = Date.now();
const email = `promi-used-${stamp}@example.com`;
const password = `used-${stamp}-aaaa`;

let failures = 0;
const line = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(50)} ${detail}`);
};

const created = await fetch(`${SUPABASE}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const userId = (await created.json()).id;

try {
  const signIn = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email, password }),
  });
  const jwt = (await signIn.json()).access_token;
  line(Boolean(jwt), 'signed in', jwt ? 'session' : 'no token');

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` };

  const issued = await fetch(`${BASE}/api/agent/connections`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ agentLabel: 'Promi' }),
  });
  const minted = (await issued.json()).data;
  line(issued.status === 201 || issued.status === 200, 'a token is issued', String(issued.status));

  const listOnce = (await (await fetch(`${BASE}/api/agent/connections`, { headers })).json()).data;
  const first = (listOnce || []).find((c) => c.id === minted.id);
  line(first && first.lastUsedAt === null, 'a new token says never used', JSON.stringify(first?.lastUsedAt));

  const used = await fetch(`${BASE}/api/agent`, { headers: { Authorization: `Bearer ${minted.token}` } });
  line(used.status === 200, 'the agent answers with it', String(used.status));

  let after = null;
  for (let i = 0; i < 10; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    const list = (await (await fetch(`${BASE}/api/agent/connections`, { headers })).json()).data;
    after = (list || []).find((c) => c.id === minted.id);
    if (after?.lastUsedAt) break;
  }
  line(Boolean(after?.lastUsedAt), 'and the row now carries a used time', String(after?.lastUsedAt));
  line(
    Boolean(after?.lastUsedAt) && Date.now() - Date.parse(after.lastUsedAt) < 60_000,
    'a time within the last minute',
    after?.lastUsedAt ? `${Math.round((Date.now() - Date.parse(after.lastUsedAt)) / 1000)}s ago` : '—'
  );

  const other = (await (await fetch(`${BASE}/api/agent/connections`, { headers })).json()).data;
  line(
    other.every((c) => 'lastUsedAt' in c),
    'every row answers the question, not only the used one',
    JSON.stringify(other.map((c) => c.lastUsedAt))
  );
} finally {
  await fetch(`${SUPABASE}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
}

console.log(failures === 0 ? '\nPASS  a token row can say when it was last used\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
