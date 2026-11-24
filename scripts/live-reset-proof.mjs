#!/usr/bin/env node
/**
 * The password reset, end to end, without anyone's inbox.
 *
 * The mail itself cannot be read here, so this asks Supabase for the same link it
 * would mail (admin generate-link), opens it in a browser, sets a new password and
 * then signs in with it. If the link lands on a 404, or the app shows the notebook
 * instead of the reset form, this fails.
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
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(44)} ${detail}`);
};

const stamp = Date.now();
const email = `promi-reset-${stamp}@example.com`;
const oldPassword = `old-${stamp}-aaaa`;
const newPassword = `new-${stamp}-bbbb`;

async function api(url, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null, text };
}

const created = await api(`${SUPABASE}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SERVICE },
  body: { email, password: oldPassword, email_confirm: true },
});
const userId = created.json?.id;
line(Boolean(userId), 'a throwaway account exists', `${created.status}`);

const link = await api(`${SUPABASE}/auth/v1/admin/generate_link`, {
  method: 'POST',
  headers: { apikey: SERVICE },
  body: { type: 'recovery', email, redirect_to: `${BASE}/app` },
});
const actionLink = link.json?.action_link || link.json?.properties?.action_link;
line(Boolean(actionLink), 'Supabase mints the recovery link', `${link.status}`);

const browser = await chromium.launch({
  executablePath: browserExecutable(),
});

try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  const response = await page.goto(actionLink, { waitUntil: 'domcontentloaded' });
  line(Boolean(response && response.status() < 400), 'the link answers', `${response?.status()} ${page.url().slice(0, 80)}`);

  const newPasswordField = page.getByText('New password', { exact: false });
  const appeared = await newPasswordField
    .first()
    .waitFor({ timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  line(appeared, 'the app asks for a new password', `url ${page.url().slice(0, 60)}`);
  await page.screenshot({ path: '/tmp/reset-form.png' });

  if (appeared) {
    const inputs = page.locator('input[type="password"]');
    const count = await inputs.count();
    line(count >= 2, 'both password fields are there', `${count} field(s)`);
    await inputs.nth(0).fill(newPassword);
    await inputs.nth(1).fill(newPassword);
    await page.getByRole('button', { name: /update password/i }).click();
    await page.waitForTimeout(4000);

    const confirmation = await page.locator('body').innerText();
    line(/password updated/i.test(confirmation), 'the password is changed', confirmation.slice(0, 60).replace(/\n/g, ' '));

    // And it is really the new one: an API sign-in with it has to work.
    const signedIn = await api(`${SUPABASE}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: PUBLIC },
      body: { email, password: newPassword },
    });
    line(Boolean(signedIn.json?.access_token), 'the new password signs in', `${signedIn.status}`);
    await page.screenshot({ path: '/tmp/reset-done.png' });
  }
} catch (error) {
  line(false, 'the reset proof ran', error.message);
} finally {
  await browser.close().catch(() => {});
  if (userId) {
    await api(`${SUPABASE}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: { apikey: SERVICE } });
    console.log('cleaned up the throwaway account');
  }
}

console.log(failures === 0 ? '\nPASS  a recovery link lands in the app and sets a new password\n' : `\n${failures} step(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
