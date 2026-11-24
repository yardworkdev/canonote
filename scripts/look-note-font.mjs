#!/usr/bin/env node
/**
 * What the note surface looks like, on the live site, in device-only mode.
 * Two screenshots: the editor with real markdown in it, and the sidebar next to it.
 */
import { chromium } from 'playwright';
import { browserExecutable } from './lib/browser.mjs';

const BASE = process.env.LIVE_URL || 'https://canonote.vercel.app';
const browser = await chromium.launch({
  executablePath: browserExecutable(),
});
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
const local = page.getByRole('button', { name: /use this device only/i });
if (await local.count()) await local.click();

const editor = page.locator('textarea[aria-label="Note editor"]').first();
await editor.waitFor({ timeout: 20000 });
await page.getByRole('button', { name: /new note/i }).first().click().catch(() => {});
await editor.click();
await page.keyboard.type(
  '# Writing together\n\nReading a note should feel like reading, not like editing a config file. This paragraph exists to judge the typeface at a normal length: a sentence you would actually write, at the size you would actually read it.\n\n## A section\n\n> Promi · 19:20\n>\n> My words sit inside a blockquote, so a line can never pass for yours.\n\nAnd here is the rest of the note, back in the usual voice.',
  { delay: 2 }
);
await page.waitForTimeout(1800);
await page.screenshot({ path: '/tmp/font-note.png' });

const font = await editor.evaluate((node) => {
  const style = getComputedStyle(node);
  return `${style.fontFamily} · ${style.fontSize} · ${style.lineHeight}`;
});
console.log('editor font:', font);
await browser.close();
