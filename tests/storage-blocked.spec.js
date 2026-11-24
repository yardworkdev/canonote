// @ts-check
import { test, expect } from '@playwright/test';

// A browser that refuses to store anything — all site data blocked, private
// mode — is the failure where the notebook used to look healthy while losing
// every keystroke: the status row claimed "Stored in this browser", the save
// failed with "Failed to save note. Please retry." (an instruction that can
// never work, because the next attempt is refused too), and the text was gone
// after a reload. Nothing in the suite covered it, which is why it survived
// (2026-10-13).
//
// This spec pins the honest behaviour: the status row names the failure, the
// message carries a step that can actually help, it is said once instead of
// once per keystroke, and nothing claims the note is stored.

test.describe('the browser refuses to store anything', () => {
  test('says so instead of claiming the notes are stored', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
    await context.addInitScript(() => {
      // The shape of a blocked store: touching it throws.
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('Access to storage is not allowed.', 'SecurityError');
        },
      });
      // Both stores, because the notebook runs on IndexedDB and falls back to
      // Web Storage: a browser that blocks site data blocks both, and blocking
      // only one would leave a working store behind and prove nothing.
      try {
        window.indexedDB.open = () => {
          throw new DOMException('Access to storage is not allowed.', 'SecurityError');
        };
      } catch {
        // An IndexedDB that will not be shadowed is left alone.
      }
    });

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    await page.goto('/app');
    const editor = page.locator('textarea[aria-label="Note editor"]').first();
    await expect(editor).toBeVisible({ timeout: 15000 });

    // The status row tells the truth about the storage it does not have.
    await expect(
      page.getByText('Notes are not being saved — this browser blocks storage')
    ).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Stored in this browser')).toHaveCount(0);

    await editor.click();
    await page.keyboard.type('# Typed while storage is blocked', { delay: 10 });

    // The failure is explained with a recovery step...
    await expect(page.getByText(/allow site data/i).first()).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);
    // ...said once, not once per keystroke...
    await expect(page.getByText(/allow site data/i)).toHaveCount(1);
    // ...and never as a bare "retry", which the browser would refuse.
    await expect(page.getByText(/failed to save note\. please retry/i)).toHaveCount(0);

    expect(pageErrors).toEqual([]);
    await context.close();
  });
});
