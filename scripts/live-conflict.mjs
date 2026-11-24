/**
 * Two writers, one note, and what the second one sees.
 *
 * The conflict path is written in code and never has been driven end to end: a
 * person writes, something else writes first, and the person's save comes back 409.
 * This script does exactly that against the live deployment and asserts what the
 * person can then do.
 *
 * It used to get the second writer from a second browser window. That no longer
 * produces a stale pane on purpose: an open note adopts a remote write within a poll,
 * so the second window's text arrives before the first one saves and there is no
 * conflict to see. The honest conflict is a pane that is *dirty* — the person is
 * typing, so the app must not replace what they are writing — against a newer server
 * revision. The second write is therefore made through the same person's own API
 * session, instantly, inside the autosave window (1.5 s).
 *
 * Run: node scripts/live-conflict.mjs
 */
import { chromium } from 'playwright';
import { readSecret } from './lib/secrets.mjs';

const BASE = 'https://canonote.vercel.app';
const SERVICE = readSecret('supabase-service-key', 'SUPABASE_SERVICE_KEY');
const stamp = Date.now();
const email = `promi-cf-${stamp}@example.com`;
const password = `cf-${stamp}-aaaa`;

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

const browser = await chromium.launch();
const contextFor = async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForSelector('main textarea', { timeout: 20000 });
  return page;
};

// Session A makes the note.
const a = await contextFor();
await a.waitForTimeout(2500);
await a.locator('main textarea').first().click();
await a.keyboard.type('written by A');
await a.waitForTimeout(2500);

// The second write comes from the same person's own session, so it is instant.
const publishable = 'sb_publishable_qB1erd1_XW71j1dJmGi4Lw_-KfNyjQd';
const session = await fetch('https://vcplldetvuezauzwyrkh.supabase.co/auth/v1/token?grant_type=password', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: publishable, Authorization: `Bearer ${publishable}` },
  body: JSON.stringify({ email, password }),
}).then((r) => r.json());
const jwt = session.access_token;
check(Boolean(jwt), 'the second writer holds the same person\'s session');

const readNote = async () => {
  const response = await fetch(`${BASE}/api/notes`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: publishable },
  });
  const list = await response.json();
  // A throwaway person holds exactly one note; take the newest row rather than a title.
  const row = (list.data || [])[0];
  const one = await fetch(`${BASE}/api/notes/${row.note_id || row.id}`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: publishable },
  }).then((r) => r.json());
  return one.data;
};

// A interjection that lands instantly, in the autosave window of a dirty pane.
const writeElsewhere = async (suffix) => {
  const note = await readNote();
  const response = await fetch(`${BASE}/api/notes/${note.note_id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, apikey: publishable },
    body: JSON.stringify({ content: `${note.content}${suffix}`, ifRevision: note.revision }),
  });
  return response.status;
};

// Round one: the person's save loses, and "Use server version" takes the other text.
await a.locator('main textarea').first().click();
await a.keyboard.press('End');
await a.keyboard.type(' — then A wrote');
const raced = await writeElsewhere(' — then B wrote');
check(raced === 200, 'the other writing lands first', String(raced));
await a.waitForTimeout(3000);

const banner = a.getByText('Conflicting server update');
const shown = await banner.count();
check(shown > 0, 'the second writer is told there is a conflict', `${shown} banner(s)`);

const actions = ['Use server version', 'Restore draft', 'Copy draft', 'Keep my version'];
for (const label of actions) {
  check((await a.getByRole('button', { name: label }).count()) > 0, `"${label}" is offered`);
}

check(
  (await a.locator('main textarea').first().inputValue()).includes('then A wrote'),
  "and the person's own text is still on screen, not thrown away"
);

// "Use server version" takes theirs.
await a.getByRole('button', { name: 'Use server version' }).click();
await a.waitForTimeout(2500);
const afterAccept = await a.locator('main textarea').first().inputValue();
check(afterAccept.includes('then B wrote'), 'Use server version loads the other writing', JSON.stringify(afterAccept.slice(0, 60)));
check(!afterAccept.includes('then A wrote'), 'and the conflicting local text is gone from the pane');

// Round two: a fresh conflict, and "Keep my version" wins.
await a.locator('main textarea').first().click();
await a.keyboard.press('End');
await a.keyboard.type(' A wins');
const raced2 = await writeElsewhere(' B again');
check(raced2 === 200, 'a second write lands first', String(raced2));
await a.waitForTimeout(3000);
const conflict2 = await a.getByText('Conflicting server update').count();
check(conflict2 > 0, 'the conflict comes back for a second round', `${conflict2} banner(s)`);
if (conflict2 > 0) {
  await a.getByRole('button', { name: 'Keep my version' }).click();
  await a.waitForTimeout(3000);
  const server = await readNote();
  check(
    String(server.content || '').includes('A wins'),
    'Keep my version reaches the server',
    JSON.stringify(String(server.content || '').slice(-40))
  );
}

await browser.close();
await fetch(`https://vcplldetvuezauzwyrkh.supabase.co/auth/v1/admin/users/${userId}`, {
  method: 'DELETE',
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
});
console.log(failures === 0 ? '\nPASS  a conflict is survivable\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
