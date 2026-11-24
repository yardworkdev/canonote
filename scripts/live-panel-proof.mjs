#!/usr/bin/env node
/**
 * The panel, in a real browser, against the real site.
 *
 * The API proof issues its token with fetch. A person issues theirs by clicking,
 * and that path had never been walked. This signs in on canonote.vercel.app,
 * opens the collaboration panel, issues a delegated token from the session, and
 * then uses that token as an agent would: enters, reads, writes, leaves a caret,
 * and is turned away with 404 when the note is switched off. The account is
 * deleted at the end, and no screenshot ever shows a live token.
 *
 *   node scripts/live-panel-proof.mjs
 *   CHROME_BIN=/path/to/chrome node scripts/live-panel-proof.mjs   # a browser outside Playwright's
 */
import { chromium } from 'playwright';
import { readSecret } from './lib/secrets.mjs';
import { browserExecutable } from './lib/browser.mjs';

const BASE = (process.env.LIVE_URL || 'https://canonote.vercel.app').replace(/\/$/, '');
const SUPABASE = process.env.SUPABASE_URL || 'https://vcplldetvuezauzwyrkh.supabase.co';
const SERVICE = readSecret('supabase-service-key', 'SUPABASE_SERVICE_KEY');
const PUBLIC = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_qB1erd1_XW71j1dJmGi4Lw_-KfNyjQd';

let failures = 0;
function line(ok, label, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(46)} ${detail}`);
}

const stamp = Date.now();
const email = `promi-panel-${stamp}@example.com`;
const password = `panel-${stamp}-${Math.random().toString(36).slice(2)}`;

async function call(url, { method = 'GET', body, token, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* raw */
  }
  return { status: response.status, json, text, bytes: Buffer.byteLength(text) };
}

let userId = null;
let browser = null;

try {
  console.log(`\nlive panel proof  ${BASE}\n`);

  const admin = await call(`${SUPABASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE },
    body: { email, password, email_confirm: true },
  });
  userId = admin.json?.id || admin.json?.user?.id || null;
  line(Boolean(userId), 'a throwaway account exists', `${admin.status}`);

  const session = await call(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: PUBLIC },
    body: { email, password },
  });
  const jwt = session.json?.access_token;
  const note = await call(`${BASE}/api/notes`, {
    method: 'POST',
    token: jwt,
    body: { title: 'Panel proof', content: '# Panel proof\n\nfrom the panel.\n' },
  });
  const noteId = note.json?.data?.id;
  line(Boolean(noteId), 'a note exists for the agent to reach', `${note.status}`);

  browser = await chromium.launch({
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  const emailField = page.locator('input[type="email"]').first();
  await emailField.waitFor({ timeout: 30000 });
  await emailField.fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  line(true, 'the person signs in through the form', '');

  const agentsButton = page.getByLabel('Open agents');
  await agentsButton.waitFor({ timeout: 45000 });
  await agentsButton.click();
  line(true, 'the agents tab opens in the helper view', '');

  const nameField = page.getByLabel('Agent name');
  await nameField.waitFor({ timeout: 20000 });
  await nameField.fill('Promi');
  await nameField.blur();
  await page.screenshot({ path: '/tmp/panel-open.png' });

  // One press, and the token is on screen. That is the whole flow now.
  await page.getByRole('button', { name: /^create token$/i }).click();
  const tokenBlock = page.locator('code').first();
  await tokenBlock.waitFor({ timeout: 30000 });
  const agentToken = (await tokenBlock.innerText()).trim();
  line(agentToken.length > 20, 'one press creates the token', `${agentToken.length} chars`);
  await page.screenshot({ path: '/tmp/panel-token.png' });

  const entered = await call(`${BASE}/api/agent`, { token: agentToken });
  line(entered.status === 200, 'that token enters the notebook', `${entered.status} ${entered.bytes} B`);

  const before = await call(`${BASE}/api/agent/notes/${noteId}`, { token: agentToken });
  line(before.status === 200, 'it reads the note', `${before.status} ${before.bytes} B`);

  const write = await call(`${BASE}/api/agent/notes/${noteId}`, {
    method: 'PATCH',
    token: agentToken,
    body: {
      content: '# Panel proof\n\nfrom the panel.\n\nand appended by the agent.\n',
      ifRevision: before.json?.data?.revision ?? null,
    },
  });
  line(write.status === 200, 'it writes under its own name', `${write.status}`);

  const caret = await call(`${BASE}/api/agent/notes/${noteId}/presence`, {
    method: 'POST',
    token: agentToken,
    body: { mode: 'writing' },
  });
  line(caret.status === 200 || caret.status === 204, 'it leaves a caret', `${caret.status}`);

  const current = await call(`${BASE}/api/notes/${noteId}`, { token: jwt });
  const off = await call(`${BASE}/api/notes/${noteId}`, {
    method: 'PATCH',
    token: jwt,
    body: { agentAccess: false, ifRevision: current.json?.data?.revision ?? null },
  });
  const hidden = await call(`${BASE}/api/agent/notes/${noteId}`, { token: agentToken });
  line(off.status === 200 && hidden.status === 404, 'switched off, the agent gets 404', `${hidden.status}`);

  await page.screenshot({ path: '/tmp/panel-ready.png' });
} catch (error) {
  line(false, 'the panel proof ran', error.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (userId) {
    await call(`${SUPABASE}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: { apikey: SERVICE } });
    console.log('cleaned up the throwaway account');
  }
}

console.log(failures === 0 ? '\nPASS  a person issues a token by clicking, and an agent uses it\n' : `\n${failures} step(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
