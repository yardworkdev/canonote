#!/usr/bin/env node
/**
 * An agent's words are never deleted by a person's save without a word.
 *
 *   node scripts/live-no-clobber.mjs
 *
 * The reported failure, driven end to end on the deployed app: a throwaway person
 * opens a note (the device now holds its text), an agent appends a paragraph, the
 * person comes back — their store still holding the older copy — and types. Before
 * this check could go red: the save claimed the server's revision with the older
 * text, was accepted, and the paragraph was gone with nothing said. Now the claim
 * is refused, the person is offered the server's version, and the paragraph is
 * still there afterwards.
 *
 * It asserts both halves: the save did not land, and choosing the server's version
 * brings the agent's paragraph on screen.
 */
import { chromium } from 'playwright';
import { readSecret } from './lib/secrets.mjs';
import { browserExecutable } from './lib/browser.mjs';

const BASE = 'https://canonote.vercel.app';
const SUPABASE = 'https://vcplldetvuezauzwyrkh.supabase.co';
const SERVICE = readSecret('supabase-service-key', 'SUPABASE_SERVICE_KEY');
const PUBLIC = 'sb_publishable_qB1erd1_XW71j1dJmGi4Lw_-KfNyjQd';

let failures = 0;
const line = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(56)} ${detail}`);
};

const stamp = Date.now();
const email = `promi-clobber-${stamp}@example.com`;
const password = `clobber-${stamp}-aaaa`;
const AGENT_LINE = 'AGENT PARAGRAPH that must survive.';

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
line(created.status === 200 || created.status === 201, 'a throwaway person exists', String(created.status));

const session = await api(`${SUPABASE}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: PUBLIC, Authorization: `Bearer ${PUBLIC}` },
  body: { email, password },
});
const jwt = session.json?.access_token;
line(Boolean(jwt), 'and can sign in');

const issued = await api(`${BASE}/api/agent/connections`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${jwt}` },
  body: { agentLabel: 'Promi', scopes: ['notes:read', 'notes:write'] },
});
const agentToken = issued.json?.data?.token;
line(Boolean(agentToken), 'a one-hour agent token is issued');

const TITLE = `Clobber ${stamp}`;
const made = await api(`${BASE}/api/notes`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${jwt}` },
  body: { noteId: `note-${stamp}-clobber`, title: TITLE, content: 'The person line.\n' },
});
const note = made.json?.data;
line(Boolean(note?.id), 'the person has a note', String(made.status));

const browser = await chromium.launch({
  executablePath: browserExecutable(),
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

try {
  const page = await context.newPage();
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole('button', { name: /sign in/i }).first().click();
  const editor = page.locator('textarea[aria-label="Note editor"]').first();
  await editor.waitFor({ timeout: 30000 });
  await page.getByText(TITLE, { exact: false }).first().click();
  await page.waitForTimeout(2500);
  await page.close();

  // The agent writes while the person's tab is gone.
  const written = await api(`${BASE}/api/agent/notes/${note.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: { content: `The person line.\n${AGENT_LINE}\n`, ifRevision: note.revision },
  });
  line(written.status === 200, 'the agent appends a paragraph', String(written.status));

  // The person comes back with the older copy and types.
  const page2 = await context.newPage();
  await page2.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  const editor2 = page2.locator('textarea[aria-label="Note editor"]').first();
  await editor2.waitFor({ timeout: 30000 });
  await page2.waitForTimeout(2500);
  await editor2.click();
  await editor2.press('End');
  await page2.keyboard.type(' person-B.', { delay: 20 });
  await page2.waitForTimeout(6000);

  const serverAfterSave = await api(`${BASE}/api/notes/${note.id}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const survived = String(serverAfterSave.json?.data?.content || '').includes(AGENT_LINE);
  line(survived, 'the save did not delete the agent’s paragraph', `revision ${serverAfterSave.json?.data?.revision}`);

  // Two acceptable outcomes, and both are honest: the reopened pane already shows
  // the server's text (it knew its copy was behind), or the person is told and the
  // server's version is one press away.
  const useServer = page2.getByRole('button', { name: /use server version/i }).first();
  if (await useServer.count()) {
    const told = await page2.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    line(/conflict/i.test(told), 'the person is told a conflict happened');
    await useServer.click();
    await page2.waitForTimeout(2500);
  } else {
    line(true, 'no conflict was needed: the pane adopted the newer text');
  }
  const pane = await editor2.inputValue();
  line(pane.includes(AGENT_LINE), 'the agent’s paragraph is on screen');
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
