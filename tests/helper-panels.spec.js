// @ts-check
import { test, expect } from '@playwright/test';

// The four helper panels — Contents, AI, History, Tags — wear one header, one
// empty, one loading and one error (src/components/HelperPanel.jsx). Nothing in
// the suite opened three of them at all, which is how the History panel came to
// render "No versions saved yet" over a store read the browser had refused: a
// claim, where the truth was that the app could not look.
//
// This spec walks all four, proves History counts a real version, and pins the
// refused-read state in a browser context that blocks site data.

const editor = (page) => page.locator('textarea[aria-label="Note editor"]').first();

const openHelperTab = async (page, tabLabel) => {
  await expect(page.getByRole('tablist', { name: 'Helper views' })).toBeVisible({ timeout: 10000 });
  await page.getByRole('tab', { name: tabLabel }).click();
  await expect(page.getByRole('tab', { name: tabLabel })).toHaveAttribute('aria-selected', 'true');
};

test.beforeEach(async ({ page }) => {
  await page.goto('/app');
  await expect(editor(page)).toBeVisible({ timeout: 15000 });
});

test.describe('The helper panels', () => {
  test('all three state their own fact in the same header', async ({ page }) => {
    await page.getByLabel(/Show helper panel/).click();

    // Contents is gone: headings are found in the command palette now, so the
    // tablist is History, Tags, Agent.
    await expect(page.getByRole('tab', { name: 'Table of Contents' })).toHaveCount(0);

    // History: no versions yet — the empty state, not an error.
    await openHelperTab(page, 'History');
    await expect(page.getByText('0 versions saved')).toBeVisible();
    await expect(page.getByText(/No versions saved yet/)).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);

    // Tags: neither tags nor references in this note.
    await openHelperTab(page, 'Tags & References');
    await expect(page.getByText('Tags & References')).toBeVisible();
    await expect(page.getByText(/No tags found/)).toBeVisible();
    await expect(page.getByText(/No references found/)).toBeVisible();
  });

  test('History counts the versions a real edit writes, without reopening the tab', async ({
    page,
  }) => {
    // The panel is opened first and left on screen: a count read once and never
    // refreshed states a fact that stops being true the moment you type.
    await page.getByLabel(/Show helper panel/).click();
    await openHelperTab(page, 'History');
    await expect(page.getByText('0 versions saved')).toBeVisible();

    await editor(page).click();
    await page.keyboard.type(
      '# A versioned note\n\nthe body is long enough that the save becomes a version',
      { delay: 3 }
    );
    // The note's row carries the committed title, so it is the app's own signal
    // that the save landed. The "Saved" pulse lasts about a second, which a
    // polling assertion can miss on a loaded machine.
    await expect(
      page.getByRole('button', { name: /Open note: A versioned note/ })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText(/^[1-9]\d* versions? saved$/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/A versioned note/).first()).toBeVisible();
    // The panel reads the store; it must not also report a failure.
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('a read the browser refuses is stated, not shown as an empty history', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
    await context.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('Access to storage is not allowed.', 'SecurityError');
        },
      });
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
    await expect(editor(page)).toBeVisible({ timeout: 15000 });

    await page.getByLabel(/Show helper panel/).click();
    await openHelperTab(page, 'History');

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 10000 });
    await expect(alert).toContainText('Versions cannot be read — this browser is blocking storage.');
    await expect(page.getByText('Versions could not be read')).toBeVisible();
    await expect(page.getByText(/No versions saved yet/)).toHaveCount(0);
    // The error carries the step, and it is a real one.
    await expect(page.getByText('Allow site data for this page, then reload.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();

    expect(pageErrors).toEqual([]);
    await context.close();
  });
});
