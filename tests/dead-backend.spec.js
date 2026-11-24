import { expect, test } from '@playwright/test';

// The deployed instance inherited VITE_SUPABASE_* from a Supabase project that
// no longer exists, so every visitor met a sign-in screen that could not
// succeed. A build must never gate the notebook behind a backend that is not
// there; it opens into the local notebook instead.
const DEAD_BACKEND_URL = 'http://127.0.0.1:5174/app';

test.describe('backend that no longer exists', () => {
  test('opens the notebook instead of a sign-in screen', async ({ page }) => {
    await page.goto(DEAD_BACKEND_URL);

    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Unlock your workspace')).toHaveCount(0);
    await expect(page.getByText('Sign in')).toHaveCount(0);
  });

  test('stores notes locally and keeps them across a reload', async ({ page }) => {
    await page.goto(DEAD_BACKEND_URL);
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 15000 });

    const marker = `dead backend note ${Date.now()}`;
    await page.locator('textarea').first().click();
    await page.keyboard.type(marker);
    await page.waitForTimeout(2000);
    await page.reload();

    await expect(page.locator('body')).toContainText(marker, { timeout: 15000 });
    await expect(page.getByText('Unlock your workspace')).toHaveCount(0);
  });
});
