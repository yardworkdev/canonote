// @ts-check
import { test, expect } from '@playwright/test';

// Slice 2's last item: the notebook's source of truth is IndexedDB, not Web
// Storage. What matters is not that an adapter exists but that the notes are
// really in the store, that nothing notebook-shaped is left behind in
// `localStorage` to go stale, and that a notebook an earlier session left in Web
// Storage comes across on the next open.

const editor = (page) => page.locator('textarea[aria-label="Note editor"]').first();

// Every notebook key in Web Storage except the backup snapshots, which live
// there on purpose: a backup kept in the store it exists to survive is not a
// backup.
const notebookKeysInWebStorage = (page) =>
  page.evaluate(() =>
    Object.keys(localStorage).filter(
      (key) => key.startsWith('local:') && !key.startsWith('local:notebook-backup')
    )
  );

const noteKeysHolding = (page, needle) =>
  page.evaluate(async (text) => {
    const entries = await window.storage.entries();
    return entries
      // The note's content key is `<user>:note-<id>`; the version history and
      // the journal record carry the text too and are not the note.
      .filter(([key, value]) => /^local:note-[^:]+$/.test(key) && value.includes(text))
      .map(([key]) => key);
  }, needle);

test.describe('the notebook store', () => {
  test('keeps the notes in IndexedDB and nothing notebook-shaped in Web Storage', async ({
    page,
  }) => {
    await page.goto('/app');
    await expect(editor(page)).toBeVisible({ timeout: 15000 });

    const text = '# Stored in IndexedDB\n\nnot in Web Storage';
    await page.getByRole('button', { name: /create (new )?note/i }).first().click();
    await editor(page).fill(text);

    // The text lands in the store the app reads through — polled, because the
    // save is debounced and asynchronous.
    await expect
      .poll(async () => (await noteKeysHolding(page, 'not in Web Storage')).length, { timeout: 15000 })
      .toBe(1);
    expect((await noteKeysHolding(page, 'not in Web Storage'))[0]).toMatch(/^local:note-/);

    // ...and no notebook key is left in Web Storage as a second, stale copy.
    expect(await notebookKeysInWebStorage(page)).toEqual([]);

    // And the note is still there, from the store, after a reload.
    await page.reload();
    await expect(editor(page)).toHaveValue(text, { timeout: 15000 });
  });

  test('moves a notebook left in Web Storage into the store on the next open', async ({ page }) => {
    // The shape of a session from before the store moved: the list cache and the
    // note's content in localStorage, nothing in IndexedDB yet.
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem(
        'local:notes-cache',
        JSON.stringify([
          {
            id: 'note-legacy',
            title: 'Legacy note',
            folder: 'private',
            createdBy: null,
            createdByName: null,
            updated: Date.now(),
            isPinned: false,
          },
        ])
      );
      localStorage.setItem('local:note-legacy', '# Legacy note\n\nwritten before the store moved');
    });

    await page.goto('/app');
    await expect(editor(page)).toBeVisible({ timeout: 15000 });

    // The note is listed and opens with its text.
    const row = page.getByRole('button', { name: /Open note: Legacy note/ }).first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.click();
    await expect(editor(page)).toHaveValue('# Legacy note\n\nwritten before the store moved');

    // It is in the store now, and Web Storage no longer holds a second copy that
    // could drift from it.
    expect(
      await page.evaluate(async () => (await window.storage.get('local:note-legacy'))?.value ?? null)
    ).toBe('# Legacy note\n\nwritten before the store moved');
    expect(await notebookKeysInWebStorage(page)).toEqual([]);
  });
});
