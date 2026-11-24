// @ts-check
import { test, expect } from '@playwright/test';

// A browser that refuses the clipboard is the failure the export dialog used to
// answer with a console warning and nothing else: the reader pressed *Copy as
// Markdown*, the copy did not happen, and the button looked like it had worked.
// The message audit (2026-10-16) found it while reading the copy, because the
// question the standard asks — what is the reader told? — had the answer
// "nothing".
//
// This spec pins the honest behaviour: the refusal is stated, with the step that
// can clear it, and no "copied" confirmation is shown for a copy that did not
// happen.

const REFUSED = 'Could not copy to the clipboard. Select the text in the editor and copy it instead.';

test.describe('the browser refuses the clipboard', () => {
  test('says so instead of showing a copy that did not happen', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('denied')) },
      });
      // `copyTextToClipboard` falls back to the legacy textarea + execCommand
      // path, so a browser that refuses the clipboard refuses both — breaking
      // only the modern path would let the fallback succeed and prove nothing.
      document.execCommand = () => false;
    });

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    await page.goto('/app');
    await page.getByLabel('Export note').click();
    await expect(page.getByRole('dialog', { name: 'Export note' })).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Copy as Markdown' }).click();

    await expect(page.getByText(REFUSED)).toBeVisible({ timeout: 5000 });
    // The confirmation the copy would have shown is not shown, and the button is
    // still the copy button rather than a check mark over a failure.
    await expect(page.getByText('Copied to clipboard.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Copy as Markdown' })).toBeVisible();

    expect(pageErrors).toEqual([]);
    await context.close();
  });
});
