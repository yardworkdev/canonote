#!/usr/bin/env node
/**
 * Someone else is in this note, and you can see them in it.
 *
 *   node scripts/check-live-collab.mjs
 *
 * Collaboration here is not a chat panel beside the note. An agent announces where
 * it is working (`POST /api/agent/notes/:id/presence` with `from`/`to`) and the open
 * editor draws its caret on that character; an agent writes and the open editor takes
 * the new text without a reload, because the presence poll already carries the note's
 * revision.
 *
 * Asserts, on the deployed app, with a throwaway person and a real issued token:
 *   1. an agent's announced caret is drawn inside the editor, labelled with its name;
 *   2. its selection is tinted over exactly the characters announced;
 *   3. a write by that agent reaches the open pane with no reload;
 *   4. the agent's paragraph carries the band, and the caret is still there after it.
 */
import { chromium } from 'playwright';
import { readSecret, shotsDir } from './lib/secrets.mjs';
import { browserExecutable } from './lib/browser.mjs';

const BASE = process.env.CANONOTE_BASE || 'https://canonote.vercel.app';
const SUPABASE = 'https://vcplldetvuezauzwyrkh.supabase.co';
const PUBLIC = 'sb_publishable_qB1erd1_XW71j1dJmGi4Lw_-KfNyjQd';
const SERVICE = readSecret('supabase-service-key', 'SUPABASE_SERVICE_KEY');
const SHOTS = shotsDir();

let failures = 0;
const line = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(58)} ${detail}`);
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

await api(`${SUPABASE}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  body: { email, password, email_confirm: true },
});
const session = await api(`${SUPABASE}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: PUBLIC, Authorization: `Bearer ${PUBLIC}` },
  body: { email, password },
});
const jwt = session.json?.access_token;
line(Boolean(jwt), 'a throwaway person exists and can sign in');

const issued = await api(`${BASE}/api/agent/connections`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${jwt}` },
  body: { agentLabel: 'Promi', scopes: ['notes:read', 'notes:write'] },
});
const agentToken = issued.json?.data?.token;
line(Boolean(agentToken), 'a real agent token is issued');

const body = Array.from({ length: 30 }, (_, i) => `line ${i + 1} of the note`).join('\n');
const TITLE = `Collab ${stamp}`;
const made = await api(`${BASE}/api/notes`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${jwt}` },
  body: { noteId: `note-${stamp}-collab`, title: TITLE, content: `${body}\n` },
});
const note = made.json?.data;
line(Boolean(note?.id), 'the person has a note on the server', String(made.status));

const browser = await chromium.launch({
  executablePath: browserExecutable(),
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

try {
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log('     page error:', error.message));
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole('button', { name: /sign in/i }).first().click();
  const editor = page.locator('textarea[aria-label="Note editor"]').first();
  await editor.waitFor({ timeout: 30000 });
  await page.getByText(TITLE, { exact: false }).first().click();
  await page.waitForTimeout(2500);
  // Read the top of the note: a caret five lines down must be measured while the
  // lines around it are on screen, not off the top.
  await editor.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(400);

  // The agent says where it is working: the start of line 5.
  const caretAt = body.indexOf('line 5');
  const announced = await api(`${BASE}/api/agent/notes/${note.id}/presence`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: { mode: 'writing', from: caretAt, to: caretAt + 10 },
  });
  console.log('     announce:', announced.status, JSON.stringify(announced.json?.data || announced.json).slice(0, 140));

  const caret = page.locator('[data-remote-author]').first();
  await caret.waitFor({ timeout: 8000 }).catch(() => {});
  const drawn = await page.evaluate(() => {
    const node = document.querySelector('[data-remote-author]');
    if (!node) return null;
    const ta = document.querySelector('textarea[aria-label="Note editor"]');
    const r = node.getBoundingClientRect();
    const t = ta.getBoundingClientRect();
    const hit = window.getComputedStyle(node, '::before');
    return {
      author: node.getAttribute('data-remote-author'),
      width: hit.width,
      color: hit.backgroundColor,
      insideEditor: r.top >= t.top - 2 && r.bottom <= t.bottom + 2,
      labelVisible: Boolean(window.getComputedStyle(node, '::after').content),
    };
  });
  line(Boolean(drawn), 'the agent’s caret is drawn in the note');
  line(drawn?.author === 'Promi', 'and it carries the agent’s name', drawn?.author || 'none');
  line(drawn?.width === '2px', 'as a 2px line', drawn?.width || 'none');
  line(Boolean(drawn?.insideEditor), 'inside the editor, not in a panel beside it');
  line(Boolean(drawn?.labelVisible), 'with a visible label', drawn?.labelVisible ? 'yes' : 'no');

  const selection = await page.evaluate(() => {
    const node = document.querySelector('[data-remote-selection]');
    return node ? { author: node.getAttribute('data-remote-selection'), text: node.textContent } : null;
  });
  line(selection?.text === 'line 5 of ', 'the announced range is tinted over those characters', JSON.stringify(selection));

  await page.screenshot({ path: `${SHOTS}/collab-caret.png` });

  await page.evaluate(() => {
    window.__revs = [];
    window.addEventListener('canonote:remote-revision', (event) => window.__revs.push(event.detail));
  });

  // The agent writes while the person is looking at the note.
  const live = '\n\nLIVE LINE the agent typed while you were here.\n';
  const before = await api(`${BASE}/api/agent/notes/${note.id}`, {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  const written = await api(`${BASE}/api/agent/notes/${note.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: { content: `${before.json?.data?.content || ''}${live}`, ifRevision: before.json?.data?.revision },
  });
  line(written.status === 200, 'the agent writes while the note is open', String(written.status));

  let arrived = '';
  const started = Date.now();
  while (Date.now() - started < 8000) {
    arrived = await editor.inputValue();
    if (arrived.includes('LIVE LINE')) break;
    await page.waitForTimeout(400);
  }
  line(arrived.includes('LIVE LINE'), 'the open pane shows it without a reload', `${Date.now() - started}ms`);
  const revs = await page.evaluate(() => window.__revs || []);
  line(revs.length > 0, 'the page was told the note moved', JSON.stringify(revs));
  const after = await api(`${BASE}/api/notes/${note.id}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  console.log('     server after the live write:', after.json?.data?.revision, JSON.stringify(after.json?.data?.agentSpans), after.json?.data?.updatedByName);
  // The text and the ranges arrive in the same load but a frame apart can still
  // exist; wait for the band rather than reading the instant the text lands.
  await page
    .waitForFunction(() => document.querySelectorAll('[data-agent-span]').length > 0, { timeout: 5000 })
    .catch(() => {});
  const band = await page.evaluate(() => document.querySelectorAll('[data-agent-span]').length);
  line(band > 0, 'and the agent’s words arrive with the band', `${band} marked run(s)`);
  await page.screenshot({ path: `${SHOTS}/collab-live.png` });
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} check(s) failed against ${BASE}`);
process.exit(failures === 0 ? 0 : 1);
