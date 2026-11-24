#!/usr/bin/env node
/**
 * Two clients, one note: is it real time?
 *
 * A throwaway account opens the notebook in a real browser. An agent token,
 * issued to that same account, then writes to one note. This measures what the
 * person's tab actually shows and how soon:
 *
 *   - presence: the agent's name appears within a poll (~3 s), because the
 *     browser polls presence while a note is open;
 *   - text: the body is not streamed. Nothing polls a note's content, so an
 *     agent's write is seen on the next reload — and a person editing at the
 *     same moment is protected by ifRevision, not by a lock.
 *
 * The note is created by the agent first, so the test never guesses which row
 * the person happened to be on. Everything it creates is deleted at the end.
 */
import { chromium } from 'playwright';
import { readSecret } from './lib/secrets.mjs';
import { browserExecutable } from './lib/browser.mjs';

const BASE = 'https://canonote.vercel.app';
const SUPABASE = 'https://vcplldetvuezauzwyrkh.supabase.co';
const SERVICE = readSecret('supabase-service-key', 'SUPABASE_SERVICE_KEY');
const PUBLIC = 'sb_publishable_qB1erd1_XW71j1dJmGi4Lw_-KfNyjQd';
const TITLE = 'Writing together';

let failures = 0;
const line = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(50)} ${detail}`);
};

const stamp = Date.now();
const email = `promi-collab-${stamp}@example.com`;
const password = `collab-${stamp}-aaaa`;

async function api(url, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

const created = await api(`${SUPABASE}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  body: { email, password, email_confirm: true },
});
const userId = created.json?.id;
line(Boolean(userId), 'a throwaway account exists', String(created.status));

const session = await api(`${SUPABASE}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: PUBLIC, Authorization: `Bearer ${PUBLIC}` },
  body: { email, password },
});
const jwt = session.json?.access_token;
line(Boolean(jwt), 'it can sign in', String(session.status));

const issued = await api(`${BASE}/api/agent/connections`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${jwt}`, apikey: PUBLIC },
  body: {
    agentLabel: 'Promi',
    scopes: ['notes:read', 'notes:write'],
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  },
});
const agentToken = issued.json?.data?.token;
line(Boolean(agentToken), 'the person issues an agent token', String(issued.status));

const agent = (path = '', { method = 'GET', body } = {}) =>
  api(`${BASE}/api/agent/notes${path}`, {
    method,
    headers: { Authorization: `Bearer ${agentToken}` },
    body,
  });

// The agent opens the note, so the person has one unambiguous row to click.
const firstLine = '# Writing together\n\nThis line is Promi, written first.';
const note = (await agent('', { method: 'POST', body: { title: TITLE, content: firstLine } })).json?.data;
line(Boolean(note?.id), 'the agent creates the note', note?.folder || '');

const browser = await chromium.launch({
  executablePath: browserExecutable(),
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });

  const emailInput = page.locator('input[type="email"]').first();
  await emailInput.waitFor({ timeout: 20000 });
  await emailInput.fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole('button', { name: /sign in/i }).first().click();

  const editor = page.locator('textarea[aria-label="Note editor"]').first();
  await editor.waitFor({ timeout: 30000 });
  line(true, 'the person is in the notebook');

  // 0. The list must say, before anything is opened, that this note is the
  // agent's — its section is named for the agent and the row carries the badge.
  await page.waitForTimeout(2500);
  const sidebarText = await page.getByRole('navigation', { name: 'Notes' }).innerText().catch(() => '');
  if (process.env.COLLAB_DEBUG) console.log('    sidebar:', JSON.stringify(sidebarText.slice(0, 200)));
  line(/promi/i.test(sidebarText), 'the sidebar names the agent', (sidebarText.match(/\bPromi[^\n]*/i) || [''])[0].slice(0, 40));
  line(/(^|\n)agent(\n|$)/i.test(sidebarText), 'the row says the note is the agent\u2019s', 'agent');
  await page.screenshot({ path: '/tmp/collab-sidebar.png' });

  // 1. The person opens the agent's note: it must show what the agent wrote.
  await page.getByText(TITLE, { exact: false }).first().click();
  await page.waitForTimeout(2500);
  const opened = await editor.inputValue();
  line(opened.includes('written first'), "the person opens the agent's note", `${opened.length} chars`);

  // 2. Presence is the live part.
  const startedAt = Date.now();
  await agent(`/${note.note_id}/presence`, {
    method: 'POST',
    body: { mode: 'writing', from: note.content.length, to: note.content.length + 40 },
  });
  let seenAfter = null;
  for (let waited = 0; waited < 12000; waited += 500) {
    const text = await page.locator('[data-presence-bar]').innerText().catch(() => '');
    if (/promi/i.test(text)) {
      seenAfter = Date.now() - startedAt;
      break;
    }
    await page.waitForTimeout(500);
  }
  line(seenAfter !== null, 'the person sees the agent, live', seenAfter === null ? 'never' : `${seenAfter} ms`);
  await page.screenshot({ path: '/tmp/collab-presence.png' });

  // 3. The open tab takes the write, without a reload.
  //    This check used to assert the opposite — that an agent's write did NOT appear
  //    until the page was reloaded. That was the limitation being measured, and the
  //    presence poll now carries the note's revision, so the write arrives on the next
  //    poll. Asserting the old limitation made a working feature fail the suite.
  const appended = `${firstLine}\n\nThis line is Ves, typing now.`;
  const written = await agent(`/${note.note_id}`, {
    method: 'PATCH',
    body: { content: appended, ifRevision: note.revision },
  });
  line(written.status === 200, 'the agent writes to the open note', String(written.status));

  const streamStarted = Date.now();
  let during = '';
  while (Date.now() - streamStarted < 8000) {
    during = await editor.inputValue();
    if (during.includes('This line is Ves')) break;
    await page.waitForTimeout(400);
  }
  line(
    during.includes('This line is Ves'),
    'the open tab shows it without a reload',
    `${Date.now() - streamStarted}ms`
  );

  // 4. The person types, then reloads: their text and the agent's must both survive.
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\nThis line is Ves, typed while the agent was in the note.', { delay: 8 });
  await page.waitForTimeout(2500);

  await page.reload({ waitUntil: 'domcontentloaded' });
  const afterReload = page.locator('textarea[aria-label="Note editor"]').first();
  await afterReload.waitFor({ timeout: 20000 });
  await page.getByText(TITLE, { exact: false }).first().click();
  await page.waitForTimeout(3000);
  const reloaded = await afterReload.inputValue();

  const server = await api(`${BASE}/api/notes/${note.note_id}`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: PUBLIC },
  });
  const serverText = server.json?.data?.content || '';
  line(
    reloaded.includes('This line is Promi'),
    'after a reload the person sees the agent text',
    `${reloaded.length} chars (server ${serverText.length})`
  );
  line(reloaded.includes('typed while the agent'), 'their own text survived too', `${reloaded.length} chars`);
  await page.screenshot({ path: '/tmp/collab-after-reload.png' });
} catch (error) {
  line(false, 'the check ran', error.message);
} finally {
  await browser.close().catch(() => {});
  await api(`${SUPABASE}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  }).catch(() => {});
}

console.log(failures === 0 ? '\nPASS  collaboration, measured\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
