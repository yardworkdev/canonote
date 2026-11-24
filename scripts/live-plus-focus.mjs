#!/usr/bin/env node
/**
 * Press "+" and keep typing, without clicking the pane first.
 *
 * The button keeps focus after a click; if the new note does not take the caret,
 * the keystrokes go into the button (every space re-activates it and creates
 * another empty note) and the person's first words are lost with no message.
 */
import { chromium } from 'playwright';
import { readSecret } from './lib/secrets.mjs';
import { browserExecutable } from './lib/browser.mjs';

const BASE = 'https://canonote.vercel.app';
const SUPABASE = 'https://vcplldetvuezauzwyrkh.supabase.co';
const SERVICE = readSecret('supabase-service-key', 'SUPABASE_SERVICE_KEY');
const CHROME = browserExecutable();

const stamp = Date.now();
const email = `promi-plus-${stamp}@example.com`;
const password = `plus-${stamp}-aaaa`;
let failures = 0;
const line = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`);
};

const created = await fetch(`${SUPABASE}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const userId = (await created.json()).id;

const rows = async () => {
  const res = await fetch(
    `${SUPABASE}/rest/v1/notes?user_id=eq.${userId}&deleted_at=is.null&select=note_id,content`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
  );
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

  const editor = page.locator('main textarea').first();
  await editor.click();
  await page.keyboard.type('A note with real text');
  let before = [];
  for (let i = 0; i < 12; i += 1) {
    await page.waitForTimeout(500);
    before = await rows();
    if (before.some((row) => (row.content || '').includes('A note with real text'))) break;
  }
  line(before.length === 1, 'one note before the press', `${before.length} row(s)`);

  await page.getByRole('button', { name: 'Create new note' }).first().click();

  // Type straight away, into whatever has focus, as a person would.
  const focused = await page.evaluate(() => document.activeElement?.tagName.toLowerCase() || 'none');
  line(focused === 'textarea', 'the caret is in the pane, not on the button', focused);
  await page.keyboard.type('typed while creating');
  await page.waitForTimeout(300);

  // Wait until the pane is ready for text.
  let ready = false;
  for (let i = 0; i < 20; i += 1) {
    ready = await page.evaluate(() => !document.querySelector('main textarea')?.readOnly);
    if (ready) break;
    await page.waitForTimeout(200);
  }
  line(ready, 'the pane becomes writable');

  await page.keyboard.type('first words of the new note');

  let stored = [];
  for (let i = 0; i < 16; i += 1) {
    await page.waitForTimeout(500);
    stored = await rows();
    if (stored.some((row) => (row.content || '').includes('first words of the new note'))) break;
  }
  line(
    stored.some((row) => (row.content || '').includes('first words of the new note')),
    'and the new note keeps them',
    JSON.stringify(stored.map((r) => (r.content || '').slice(0, 22)))
  );
  line(stored.length === 2, 'exactly one note was created', `1 → ${stored.length}`);
  const keep = stored.find((row) => (row.content || '').includes('A note with real text'));
  line(
    keep?.content === 'A note with real text',
    'and the note before it is untouched',
    keep ? JSON.stringify(keep.content) : 'missing'
  );

  await page.screenshot({ path: '/tmp/plus-focus.png' });
} finally {
  await browser.close();
  await fetch(`${SUPABASE}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
}

console.log(failures === 0 ? '\nPASS  "+" hands the caret to the new note\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
