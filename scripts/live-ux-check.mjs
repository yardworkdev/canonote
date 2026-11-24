#!/usr/bin/env node
/**
 * The three things a person asked for, checked on the live site:
 *
 * 1. Three tabs in the Helper View, no Contents.
 * 2. Hovering a toolbar control explains it (including a disabled one).
 * 3. Ctrl+K finds a heading in the note and jumps the caret there.
 *
 * It runs in device-only mode on purpose: none of this needs an account, and a
 * check that needs one fails for reasons that are not about the UI.
 */
import { chromium } from 'playwright';
import { ensurePreview } from './lib/preview.mjs';

// Same rule as check-live-app: drive production only when you name it, and own
// your own device-only server otherwise. The hard-coded browser path is gone -
// it only worked on one machine.
const preview = process.env.LIVE_URL
  ? null
  : await ensurePreview({
      port: 8185,
      outDir: 'dist-device',
      env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
    });
if (preview) process.on('exit', preview.stop);
const BASE = process.env.LIVE_URL || preview.base;
let failures = 0;
const line = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(46)} ${detail}`);
};

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });

  const local = page.getByRole('button', { name: /use this device only/i });
  if (await local.count()) await local.click();

  const editor = page.locator('textarea').first();
  await editor.waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: /create note/i }).first().click();
  await editor.click();
  await page.keyboard.type('# Alpha section\n\nsome text\n\n## Beta section\n\nmore text', { delay: 4 });
  await page.waitForTimeout(1500);

  // 1. Hover help.
  const bold = page.getByRole('button', { name: 'Bold', exact: true });
  await bold.hover();
  const boldTip = page.getByRole('tooltip');
  const boldText = (await boldTip.first().innerText({ timeout: 5000 }).catch(() => '')).trim();
  line(/bold/i.test(boldText), 'hovering Bold explains it', boldText);
  await page.screenshot({ path: '/tmp/ux-tooltip.png' });

  // A disabled control has to explain itself too — that is where you need it.
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(600);
  const clear = page.getByRole('button', { name: 'Clear all content' });
  const clearDisabled = await clear.isDisabled();
  await clear.hover();
  const clearText = (await page.getByRole('tooltip').first().innerText({ timeout: 5000 }).catch(() => '')).trim();
  line(clearDisabled && /empty/i.test(clearText), 'a disabled control says why', clearText);

  await page.keyboard.type('# Alpha section\n\nsome text\n\n## Beta section\n\nmore text', { delay: 4 });
  await page.waitForTimeout(1500);

  // 2. Three tabs, and Contents is not one of them.
  const helperToggle = page.getByRole('button', { name: /show helper panel|hide helper panel/i }).first();
  if (await helperToggle.count()) {
    const label = await helperToggle.getAttribute('aria-label');
    if (/show/i.test(label || '')) await helperToggle.click();
  }
  await page.getByRole('tablist', { name: 'Helper views' }).waitFor({ timeout: 10000 });
  const tabs = await page.getByRole('tab').allInnerTexts();
  line(!tabs.some((tab) => /contents/i.test(tab)), 'no Contents tab', tabs.join(' | '));
  line(tabs.length === 3, 'three tabs', String(tabs.length));
  await page.screenshot({ path: '/tmp/ux-helper-tabs.png' });

  // 3. Command palette finds a heading and jumps there.
  await page.keyboard.press('Control+k');
  // The palette's own wording, not a remembered one: this check asserted a
  // placeholder that had been rewritten, so it failed while the palette worked.
  const input = page.getByPlaceholder(/type a command, heading or note/i);
  await input.waitFor({ timeout: 5000 });
  await input.fill('Beta');
  const result = page.getByRole('option', { name: /Beta section/i });
  const hasResult = await result.count();
  line(hasResult > 0, 'Ctrl+K lists the heading', String(hasResult));
  if (hasResult) {
    await result.first().click();
    await page.waitForTimeout(800);
    const selection = await page.evaluate(() => {
      const area = document.querySelector('textarea');
      return area ? area.value.slice(area.selectionStart, area.selectionStart + 30) : '';
    });
    line(/Beta section/.test(selection), 'jumping puts the caret on it', JSON.stringify(selection));
  }
  await page.screenshot({ path: '/tmp/ux-palette.png' });
} catch (error) {
  line(false, 'the check ran', error.message);
} finally {
  await browser.close().catch(() => {});
}

console.log(failures === 0 ? '\nPASS  hover help, three tabs, headings in the palette\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
