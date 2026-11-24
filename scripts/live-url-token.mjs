/**
 * A token in the URL is answered as if no token were sent.
 *
 * AGENTS.md makes that promise and nothing had asked the live deployment to honour
 * it. This issues a real token, calls the agent API three ways — header, query
 * string, query string with no header — and reports what came back.
 *
 * Run: node scripts/live-url-token.mjs
 */
import { readSecret } from './lib/secrets.mjs';

const BASE = 'https://canonote.vercel.app';
const SERVICE = readSecret('supabase-service-key', 'SUPABASE_SERVICE_KEY');
const stamp = Date.now();
const email = `promi-ut-${stamp}@example.com`;
const password = `ut-${stamp}-aaaa`;

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(58)} ${detail}`);
};

const created = await fetch('https://vcplldetvuezauzwyrkh.supabase.co/auth/v1/admin/users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const userId = (await created.json()).id;

const auth = await fetch(
  'https://vcplldetvuezauzwyrkh.supabase.co/auth/v1/token?grant_type=password',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SERVICE },
    body: JSON.stringify({ email, password }),
  }
);
const { access_token: jwt } = await auth.json();
const issued = await fetch(`${BASE}/api/agent/connections`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
  body: JSON.stringify({ name: 'url-token-test' }),
});
const body = await issued.json();
const token = body?.data?.token;
check(issued.status === 201 && typeof token === 'string', 'a token is issued', `${issued.status}`);

const call = (url, headers) => fetch(`${BASE}${url}`, { headers });

const byHeader = await call('/api/agent/notes?limit=1', { Authorization: `Bearer ${token}` });
check(byHeader.status === 200, 'the header is accepted', `${byHeader.status}`);

const byQuery = await call(`/api/agent/notes?limit=1&token=${encodeURIComponent(token)}`);
check(byQuery.status === 401, 'a token in the URL is not accepted', `${byQuery.status}`);
const queryBody = await byQuery.json().catch(() => ({}));
check(
  !JSON.stringify(queryBody).includes(token.slice(0, 12)),
  'and the answer does not echo it back',
  JSON.stringify(queryBody).slice(0, 60)
);

const xHeader = await call('/api/agent/notes?limit=1', { 'x-agent-token': token });
check(xHeader.status === 200, 'the agent header also works', `${xHeader.status}`);

// Revoke, so the test leaves nothing behind.
await fetch(`${BASE}/api/agent/connections/${body.data.id}`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${jwt}` },
});
const afterRevoke = await call('/api/agent/notes?limit=1', { Authorization: `Bearer ${token}` });
check(afterRevoke.status === 401, 'a revoked token stops working', `${afterRevoke.status}`);

await fetch(`https://vcplldetvuezauzwyrkh.supabase.co/auth/v1/admin/users/${userId}`, {
  method: 'DELETE',
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
});
console.log(failures === 0 ? '\nPASS  the token has one address\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
