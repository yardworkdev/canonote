#!/usr/bin/env node
/**
 * The first note a brand-new account writes must reach the server.
 *
 * It did not: the empty pane a signed-in person sees is `note-default`, which is
 * not a row, and nothing ever created it. Every save answered 404, the local list
 * looked convincing, and the text was gone on the next load. This signs up a
 * fresh account, types into that pane without touching "New note", reloads, and
 * checks the note is still there — and that the server has it.
 */
import { chromium } from 'playwright';
import { readSecret } from './lib/secrets.mjs';
import { browserExecutable } from './lib/browser.mjs';

const BASE = 'https://canonote.vercel.app';
const SUPABASE = 'https://vcplldetvuezauzwyrkh.supabase.co';
const SERVICE = readSecret('supabase-service-key', 'SUPABASE_SERVICE_KEY');
const PUBLIC = 'sb_publishable_qB1erd1_XW71j1dJmGi4Lw_-KfNyjQd';
const CHROME = browserExecutable();

const stamp = Date.now();
const email = `promi-first-${stamp}@example.com`;
const password = `first-${stamp}-aaaa`;
const text = 'My very first note, typed into the empty pane.';

let failures = 0;
const line = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(54)} ${detail}`);
};

const created = await fetch(`${SUPABASE}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const userId = (await created.json()).id;

const serverNotes = async () => {
  const res = await fetch(`${SUPABASE}/rest/v1/notes?user_id=eq.${userId}&deleted_at=is.null&select=note_id,content,title`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  return res.json();
};

const browser = await chromium.launch({ executablePath: CHROME });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForTimeout(3500);

  // Type into whatever pane is open. No "New note" button, no explicit create.
  await page.locator('main textarea').first().click();
  await page.keyboard.type(text);
  await page.waitForTimeout(3000);

  const afterTyping = await serverNotes();
  line(
    Array.isArray(afterTyping) && afterTyping.some((row) => (row.content || '').includes(text)),
    'the first note reaches the server',
    `${afterTyping.length} row(s)`
  );

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  const nav = page.getByRole('navigation', { name: 'Notes' });
  const listed = await nav.innerText().catch(() => '');
  line(listed.includes('My very first note'), 'and it is in the sidebar after a reload', listed.split('\n')[0] || '');

  const editorText = await page.locator('main textarea').first().inputValue().catch(() => '');
  line(editorText.includes(text), 'with its text intact', `${editorText.length} chars`);

  // A second note must start empty. It used to inherit the first one's text: the
  // "pane is ahead" guard treated an empty server answer as a prefix of anything.
  await page.getByRole('button', { name: 'Create new note' }).first().click();
  await page.waitForTimeout(1500);
  const fresh = await page.locator('main textarea').first().inputValue();
  line(fresh === '', 'a new note starts empty', `${fresh.length} chars`);

  // The pane is read-only while the note is being made, and says so. Type once it
  // is writable, the way a person waiting a moment would.
  for (let i = 0; i < 25; i += 1) {
    if (await page.evaluate(() => !document.querySelector('main textarea')?.readOnly)) break;
    await page.waitForTimeout(150);
  }
  await page.locator('main textarea').first().click();
  await page.keyboard.type('SECOND NOTE');
  // Poll rather than sleep: the write is debounced and the deploy's latency is not
  // ours to assume. A fixed 2.5 s made this check fail while the save was in flight.
  let rows = await serverNotes();
  for (let i = 0; i < 20; i += 1) {
    if ((rows || []).some((row) => (row.content || '').trim() === 'SECOND NOTE')) break;
    await page.waitForTimeout(500);
    rows = await serverNotes();
  }
  const bodies = (rows || []).map((row) => (row.content || '').trim());
  line(
    bodies.includes('SECOND NOTE'),
    'the second note holds only its own text',
    JSON.stringify(bodies.map((body) => body.slice(0, 24)))
  );
  line(
    bodies.includes(text),
    'and the first note is unchanged',
    bodies.find((body) => body.includes('first note')) ? 'intact' : 'missing'
  );

  // Switching back shows the first note again, not a mix.
  console.log('rows:', JSON.stringify(await page.locator('nav button[aria-label^="Open note"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))));
  await page.getByRole('button', { name: /Open note: My very first note/i }).first().click();
  await page.waitForTimeout(4500);
  const back = await page.locator('main textarea').first().inputValue();
  line(back.trim() === text, 'switching back shows the first note', `${back.length} chars: ${JSON.stringify(back.slice(0, 30))}`);
  line(!back.includes('SECOND NOTE'), 'with no text from the other note', '');

  await page.screenshot({ path: '/tmp/first-note.png' });
} finally {
  await browser.close();
  await fetch(`${SUPABASE}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
}

console.log(failures === 0 ? '\nPASS  the first note survives\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
