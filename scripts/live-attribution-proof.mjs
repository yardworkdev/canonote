#!/usr/bin/env node
/**
 * The words an agent wrote, on screen, behind a background.
 *
 * A throwaway person writes a note; an agent token appends a paragraph; the
 * person reloads. The words that were not there in their own last version must
 * be painted. Two screenshots and a pass/fail on what the highlight layer holds.
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
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`);
};

const stamp = Date.now();
const email = `promi-attrib-${stamp}@example.com`;
const password = `attrib-${stamp}-aaaa`;

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

const session = await api(`${SUPABASE}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: PUBLIC, Authorization: `Bearer ${PUBLIC}` },
  body: { email, password },
});
const jwt = session.json?.access_token;

const issued = await api(`${BASE}/api/agent/connections`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${jwt}` },
  body: {
    agentLabel: 'Promi',
    scopes: ['notes:read', 'notes:write'],
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  },
});
const agentToken = issued.json?.data?.token;

const browser = await chromium.launch({
  executablePath: browserExecutable(),
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  const emailInput = page.locator('input[type="email"]').first();
  await emailInput.waitFor({ timeout: 20000 });
  await emailInput.fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole('button', { name: /sign in/i }).first().click();

  const editor = page.locator('textarea[aria-label="Note editor"]').first();
  await editor.waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /new note/i }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  await editor.click();
  await page.keyboard.type(
    '# Plans for the week\n\nMonday: the notebook. Tuesday: the agent API. Wednesday: nothing at all.',
    { delay: 4 }
  );
  // Wait for the note to exist on the server, not 2.5 s and a hope. Inside
  // check:all the box is busy and the same sleep that is plenty alone left this
  // check reading an empty note, so the agent's write went somewhere else and the
  // band was never painted — a failure with no cause in the product.
  let note = null;
  for (let waited = 0; waited < 20000; waited += 500) {
    const notes = await api(`${BASE}/api/notes`, { headers: { Authorization: `Bearer ${jwt}` } });
    note = (notes.json?.data || []).find((entry) => entry.title?.includes('Plans for the week'));
    if (note?.id) break;
    await page.waitForTimeout(500);
  }
  line(Boolean(note?.id), 'the person has a note', note?.id || '');

  const before = await api(`${BASE}/api/notes/${note.id}`, { headers: { Authorization: `Bearer ${jwt}` } });
  console.log('    before agent write:', JSON.stringify({ spans: before.json?.data?.agentSpans, chars: before.json?.data?.content?.length }));
  const appended = `${before.json.data.content}\n\nThe agent added this paragraph. It is the agent's, and the page should say so without a legend.\n\nAnd one more line, for a two-line block.`;
  const written = await api(`${BASE}/api/agent/notes/${note.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: { content: appended, ifRevision: note.revision },
  });
  line(written.status === 200, 'the agent appends a paragraph', String(written.status));

  // A second note the agent owns outright, so the sidebar shows both states.
  await api(`${BASE}/api/agent/notes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agentToken}` },
    body: { title: 'The agent\u2019s own note', content: 'Only the agent wrote this one.' },
  });

  const detail = await api(`${BASE}/api/notes/${note.id}`, { headers: { Authorization: `Bearer ${jwt}` } });
  const spans = detail.json?.data?.agentSpans || [];
  line(spans.length > 0, 'the server says which characters are the agent\u2019s', `${spans.length} range(s)`);

  const rows = await api(
    `${SUPABASE}/rest/v1/notes?user_id=eq.${userId}&select=note_id,created_by,updated_by,content,agent_spans,folder`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
  );
  console.log('    rows:', JSON.stringify(rows.json));
  // Two ways a person meets the agent's words: the same tab, reloaded, with a
  // local copy on the device (SAME_TAB=1) — and a second device, which has none.
  let page2;
  if (process.env.SAME_TAB) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('textarea[aria-label="Note editor"]').first().waitFor({ timeout: 20000 });
    const row = page.getByText('Plans for the week', { exact: false }).first();
    await row.waitFor({ timeout: 20000 });
    await row.click();
    await page.waitForTimeout(2500);
    page2 = page;
  } else {
    await page.close();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    page2 = await context.newPage();
    await page2.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
    const email2 = page2.locator('input[type="email"]').first();
    await email2.waitFor({ timeout: 20000 });
    await email2.fill(email);
    await page2.locator('input[type="password"]').first().fill(password);
    await page2.getByRole('button', { name: /sign in/i }).first().click();
    await page2.locator('textarea[aria-label="Note editor"]').first().waitFor({ timeout: 30000 });
    // The click has to land. Swallowing it meant the check opened whatever note
    // was first and then reported the absence of text it never asked for.
    const row = page2.getByText('Plans for the week', { exact: false }).first();
    await row.waitFor({ timeout: 20000 });
    await row.click();
  }
  // The note is fetched when it opens; wait for the agent's words to arrive.
  const editor2 = page2.locator('textarea[aria-label="Note editor"]').first();
  let value = await editor2.inputValue().catch(() => '');
  for (let waited = 0; waited < 15000 && !value.includes('The agent added this paragraph'); waited += 500) {
    await page2.waitForTimeout(500);
    value = await editor2.inputValue();
  }
  console.log('    editor has the agent text:', value.includes('The agent added this paragraph'));

  // The ranges arrive with the note; give the pane a moment to paint them.
  let marked = [];
  for (let waited = 0; waited < 12000 && marked.length === 0; waited += 500) {
    await page2.waitForTimeout(500);
    marked = await page2
      .locator('[data-agent-highlights] [data-agent-span]')
      .allInnerTexts()
      .catch(() => []);
  }
  const text = marked.join(' ');
  console.log('    spans:', JSON.stringify(spans));
  console.log('    marked:', JSON.stringify(marked.map((t) => t.slice(0, 60))));
  line(text.includes('The agent added this paragraph'), 'the agent\u2019s words carry a background', `${marked.length} run(s)`);
  line(!text.includes('Monday: the notebook'), 'the person\u2019s words do not', '');
  // Typing above the agent's paragraph must not move the band off it: the spans
  // are offsets, and they have to travel with the text while the person writes.
  await editor2.click();
  await page2.keyboard.press('Control+Home');
  await page2.keyboard.type('A line typed above everything.\n\n', { delay: 5 });
  await page2.waitForTimeout(2500);
  const afterTyping = await page2
    .locator('[data-agent-highlights] [data-agent-span]')
    .allInnerTexts()
    .catch(() => []);
  const painted = afterTyping.join(' ');
  line(
    painted.includes('The agent added this paragraph'),
    'the band stays on the agent\u2019s words while typing',
    `${afterTyping.length} run(s)`
  );
  line(!painted.includes('A line typed above'), 'and not on the new line', '');

  await page2.screenshot({ path: '/tmp/attribution.png' });
} catch (error) {
  line(false, 'the check ran', error.message);
} finally {
  await browser.close().catch(() => {});
  await api(`${SUPABASE}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  }).catch(() => {});
}

console.log(failures === 0 ? '\nPASS  attribution, painted\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
