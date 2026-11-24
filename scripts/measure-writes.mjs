#!/usr/bin/env node
/**
 * How many canonical writes does typing cost?
 *
 * Signs a throwaway account in, types a known number of characters into one
 * note, and counts the PATCH /api/notes/:id requests the browser makes. Every
 * one of those is a version row in note_versions, so this is also what a
 * writing session costs the history.
 */
import { chromium } from 'playwright';
import { readSecret } from './lib/secrets.mjs';
import { browserExecutable } from './lib/browser.mjs';

const BASE = 'https://canonote.vercel.app';
const SUPABASE = 'https://vcplldetvuezauzwyrkh.supabase.co';
const SERVICE = readSecret('supabase-service-key', 'SUPABASE_SERVICE_KEY');
const PUBLIC = 'sb_publishable_qB1erd1_XW71j1dJmGi4Lw_-KfNyjQd';
const stamp = Date.now();
const email = `promi-writes-${stamp}@example.com`;
const password = `writes-${stamp}-aaaa`;

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

const browser = await chromium.launch({
  executablePath: browserExecutable(),
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const patches = [];
  page.on('request', (request) => {
    const url = request.url();
    if (request.method() === 'PATCH' && url.includes('/api/notes/')) {
      const body = request.postData() || '';
      let chars = null;
      try {
        chars = JSON.parse(body).content?.length ?? null;
      } catch {
        // A body that is not JSON is not a note write; the count stays null.
      }
      patches.push(chars);
      console.log('  PATCH', url.replace(BASE, ''), '|', body.slice(0, 90).replace(/\s+/g, ' '));
    }
  });

  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  const emailInput = page.locator('input[type="email"]').first();
  await emailInput.waitFor({ timeout: 20000 });
  await emailInput.fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole('button', { name: /sign in/i }).first().click();

  const editor = page.locator('textarea[aria-label="Note editor"]').first();
  await editor.waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /new note/i }).first().click().catch(() => {});
  // A person clicks the button, then starts writing; IMMEDIATE types straight
  // away, which is the case where the new note is still being created.
  if (!process.env.IMMEDIATE) await page.waitForTimeout(1500);
  await editor.click();

  const text = 'Typing at a normal pace, the way a person writes a sentence into a note.';
  const before = patches.length;
  await page.keyboard.type(text, { delay: 60 });
  await page.waitForTimeout(4000);
  const after = patches.length;

  const shown = await editor.inputValue();
  const notes = await api(`${BASE}/api/notes`, { headers: { Authorization: `Bearer ${jwt}` } }).catch(() => ({}));
  console.log('editor value:', JSON.stringify(shown));
  console.log(`typed ${text.length} chars`);
  console.log(`PATCH requests: ${after - before}`);
  console.log(`sizes: ${patches.slice(before, before + 12).join(', ')}${after - before > 12 ? ' …' : ''}`);
} finally {
  await browser.close().catch(() => {});
  await api(`${SUPABASE}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  }).catch(() => {});
}
