// @ts-check
import { test, expect } from '@playwright/test';

// The public front end is not the tool: '/' is the marketing page and '/app' is
// the notebook. A CTA must carry a visitor from one to the other.

test('the public front end loads at / with a working call to action', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);

  await expect(page).toHaveTitle(/canonote/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/notebook your/i);

  const cta = page.getByRole('link', { name: /open the notebook/i }).first();
  await expect(cta).toBeVisible();
  // Relative, so the same build works at a domain root and under a project subpath
  // (user.github.io/<repo>/), where an absolute /app would jump to the wrong host path.
  await expect(cta).toHaveAttribute('href', './app');
});

test('the hero shows the real notebook', async ({ page }) => {
  await page.goto('/');
  const shot = page.locator('figure.shot img').first();
  await expect(shot).toBeVisible();
  const natural = await shot.evaluate((img) => img.naturalWidth);
  expect(natural).toBeGreaterThan(1000);
});

test('the call to action opens the notebook', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /open the notebook/i }).first().click();
  await expect(page.locator('textarea[aria-label="Note editor"]').first()).toBeVisible({
    timeout: 15000,
  });
});

test('the notebook lives at /app, not at the front end', async ({ page }) => {
  await page.goto('/app');
  await expect(page.locator('textarea[aria-label="Note editor"]').first()).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText('a notebook your agent can write into')).toHaveCount(0);
});
