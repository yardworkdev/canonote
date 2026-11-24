// @ts-check
import { test, expect } from '@playwright/test';

// Slice 4's audit item, the surface half: the trail of agent edits is read from
// the server and shown, newest first.
//
// What an end-to-end test can prove here is the shipped default: the notebook
// has no account, so the panel opens on the honest fact and asks the server
// nothing at all — no request, no error, no empty list pretending to be a
// trail. The rendering of events that a session *can* read is covered by
// src/components/AgentActivity.test.jsx, because a session needs a configured
// backend and the app in local mode has none.

const paletteInput = (page) => page.getByPlaceholder(/type a command/i);

const openPanel = async (page) => {
  await page.locator('body').click();
  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeVisible({ timeout: 5000 });
  await paletteInput(page).fill('agent activity');
  await page.getByRole('option', { name: /agent activity/i }).click();
  await expect(page.getByRole('dialog', { name: 'Agent activity' })).toBeVisible({ timeout: 5000 });
};

test('the trail panel states there is no account, and never calls the server', async ({ page }) => {
  const auditRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/agent/audit')) auditRequests.push(request.url());
  });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/app');
  await expect(page.locator('textarea[aria-label="Note editor"]').first()).toBeVisible({
    timeout: 15000,
  });

  await openPanel(page);

  await expect(
    page.getByText('No account is connected, so there is no agent trail to read.')
  ).toBeVisible({ timeout: 5000 });
  // A retry cannot help here, so the panel offers none.
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  expect(auditRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('the panel closes on Escape and leaves the notebook usable', async ({ page }) => {
  await page.goto('/app');
  await expect(page.locator('textarea[aria-label="Note editor"]').first()).toBeVisible({
    timeout: 15000,
  });

  await openPanel(page);
  await page.keyboard.press('Escape');

  await expect(page.getByRole('dialog', { name: 'Agent activity' })).toHaveCount(0);
});
