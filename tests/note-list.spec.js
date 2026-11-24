// @ts-check
import { test, expect } from '@playwright/test';

// The note list is the surface the roadmap's first slice calls "row anatomy":
// what a row shows without opening the note, and what can be done to several
// rows at once. Both live here rather than in notebook.spec.js, which covers
// the notebook's core flows.

const editor = (page) => page.locator('textarea[aria-label="Note editor"]').first();

test.beforeEach(async ({ page }) => {
  await page.goto('/app');
  await expect(editor(page)).toBeVisible({ timeout: 15000 });
});

// A note is created the way a user creates one, and the spec waits for the
// app's own save signal — a fixed sleep before acting on a committed note is a
// flake on a loaded machine.
const createNote = async (page, text) => {
  await page.getByRole('button', { name: /create (new )?note/i }).first().click();
  await editor(page).click();
  await page.keyboard.type(text, { delay: 5 });
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10000 });
};

test.describe('The note list', () => {
  test('a row carries the note\u2019s second line, without opening it', async ({ page }) => {
    await createNote(page, '# Row second line\n\nbody line of the note');

    const row = page.getByRole('button', { name: /Open note: Row second line/ }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('body line of the note');
  });

  test('deletes several selected notes in one action, and they stay deleted', async ({ page }) => {
    await createNote(page, '# First note\n\none');
    await createNote(page, '# Second note\n\ntwo');
    await expect(page.getByRole('button', { name: /Open note: First note/ }).first()).toBeVisible();

    await page.getByLabel('Select notes').click();

    // A row toggles selection instead of opening the note while the mode is on.
    await page.getByRole('button', { name: 'Select note: First note' }).click();
    await page.getByRole('button', { name: 'Select note: Second note' }).click();
    await expect(page.getByText('2 selected')).toBeVisible();

    await page.getByLabel('Delete 2 selected notes').click();
    const dialog = page.getByRole('dialog', { name: 'Delete notes' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Delete 2 notes?');

    // The keys the two notes own, read before the delete so the spec can prove
    // the content went with the rows.
    const noteKeys = await page.evaluate(async () =>
      (await window.storage.entries())
        .map(([key]) => key)
        .filter(
          (key) =>
            /:note-\d/.test(key) && !key.includes('note-versions:') && !key.includes('note-draft:')
        )
    );
    expect(noteKeys).toHaveLength(2);

    await dialog.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByRole('button', { name: /Open note: First note/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Open note: Second note/ })).toHaveCount(0);
    // The delete leaves the list in its normal state, not in selection mode.
    await expect(page.getByText('2 selected')).toHaveCount(0);
    await expect(page.getByLabel('Select notes')).toBeVisible();

    // The content and the version history went with the rows, not just the rows.
    const keys = await page.evaluate(async () =>
      (await window.storage.entries()).map(([key]) => key)
    );
    noteKeys.forEach((key) => expect(keys).not.toContain(key));
    expect(keys.filter((key) => key.includes('note-versions:'))).toEqual([]);

    await page.reload();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /Open note: First note/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Open note: Second note/ })).toHaveCount(0);
  });

  test('leaves selection mode on Escape, and select all acts on the rows on screen', async ({
    page,
  }) => {
    await createNote(page, '# Alpha note\n\none');
    await createNote(page, '# Beta note\n\ntwo');

    await page.getByLabel('Select notes').click();
    await page.getByLabel('Select all notes').click();
    await expect(page.getByText('2 selected')).toBeVisible();

    // Escape is the keyboard path out of the mode; the rows go back to opening
    // the note they name.
    await page.getByRole('button', { name: 'Select note: Beta note' }).press('Escape');
    await expect(page.getByRole('button', { name: /Open note: Beta note/ })).toBeVisible();
  });

  test('says so when a search matches nothing', async ({ page }) => {
    await createNote(page, '# Searchable note\n\nbody');
    await expect(page.getByRole('button', { name: /Open note: Searchable note/ })).toBeVisible();

    await page.getByLabel('Search notes').fill('nothing matches this at all');

    await expect(page.getByText('No notes found')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Try a different search term')).toBeVisible();
  });
});
