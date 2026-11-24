// @ts-check
import { test, expect } from '@playwright/test';

// Slice 2's second half: the notebook states where its notes live, how much
// room they take and when the last backup was, and a notebook whose store is
// lost comes back from that backup.
//
// The recovery case is the one worth an end-to-end test: the app has one copy
// of every note, so the backup has to prove it can put them back — not just
// that a button exists.

const editor = (page) => page.locator('textarea[aria-label="Note editor"]').first();
const paletteInput = (page) => page.getByPlaceholder(/type a command/i);

const openStoragePanel = async (page) => {
  await page.locator('body').click();
  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeVisible({ timeout: 5000 });
  await paletteInput(page).fill('storage');
  await page.getByRole('option', { name: /storage health/i }).click();
  await expect(page.getByRole('dialog', { name: 'Storage' })).toBeVisible({ timeout: 5000 });
};

const typeANote = async (page) => {
  await editor(page).click();
  await page.keyboard.type('# Alpha\n\nthe body of the note', { delay: 5 });
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15000 });
};

/**
 * Lose the notebook and keep the backups: every note and the list cache out of
 * the IndexedDB store, the backup snapshots in Web Storage untouched. Run on the
 * landing page — same origin, no app code — because the notebook flushes its
 * last draft on `pagehide` and would write the note straight back into a store
 * wiped while it was open.
 */
const wipeNotebookStore = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open('canonote', 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('kv');
        };
        request.onerror = () => resolve();
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('kv')) {
            resolve();
            return;
          }
          const transaction = database.transaction('kv', 'readwrite');
          const store = transaction.objectStore('kv');
          const keysRequest = store.getAllKeys();
          keysRequest.onsuccess = () => {
            keysRequest.result
              .filter((key) => key === 'local:notes-cache' || String(key).startsWith('local:note-'))
              .forEach((key) => store.delete(key));
          };
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => resolve();
          transaction.onabort = () => resolve();
        };
      })
  );

test.describe('storage health', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });
  });

  test('states where the notes live and backs the notebook up on demand', async ({ page }) => {
    await typeANote(page);
    await openStoragePanel(page);

    await expect(page.getByText('In this browser, on this device')).toBeVisible();
    await expect(page.getByText(/1 note, about .* in this browser/)).toBeVisible();

    await page.getByRole('button', { name: /back up now/i }).click();
    await expect(page.getByText('Backed up 1 note.', { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText(/just now — 1 note/)).toBeVisible();

    // Escape closes it, like every other dialog in the app.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Storage' })).toBeHidden();
  });

  test('a notebook whose store is lost comes back from the backup', async ({ page }) => {
    await typeANote(page);
    await openStoragePanel(page);
    await page.getByRole('button', { name: /back up now/i }).click();
    await expect(page.getByText('Backed up 1 note.', { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await page.keyboard.press('Escape');

    // Lose the notebook, keep the backups — the failure this feature exists for.
    // The wipe runs before the app boots on the next load, on the landing page:
    // the notebook flushes its last draft on pagehide, so clearing the store
    // while it is still open just lets it write the note straight back. The
    // backups live in Web Storage, one store over from the notes, which is why
    // they survive the notes' store being wiped.
    await page.close();
    const recovered = await page.context().newPage();
    await recovered.goto('/');
    await wipeNotebookStore(recovered);

    await recovered.goto('/app');
    await expect(editor(recovered)).toBeVisible({ timeout: 15000 });
    await expect(recovered.getByLabel(/^Open note:/)).toHaveCount(0);

    await openStoragePanel(recovered);
    await recovered.getByRole('button', { name: /restore latest backup/i }).click();

    await expect(recovered.getByText(/^Restored 1 note from the backup taken/)).toBeVisible({
      timeout: 10000,
    });

    // The note is listed again, and opening it shows the text that was typed.
    const row = recovered.getByLabel(/^Open note: Alpha$/);
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.click();
    await expect(editor(recovered)).toHaveValue(/the body of the note/, { timeout: 10000 });
  });

  test('says when there is nothing to restore', async ({ page }) => {
    await typeANote(page);
    await openStoragePanel(page);
    await page.getByRole('button', { name: /back up now/i }).click();
    await expect(page.getByText('Backed up 1 note.', { exact: true })).toBeVisible({
      timeout: 10000,
    });

    // Every note in the backup is still here, so restoring adds nothing.
    await page.getByRole('button', { name: /restore latest backup/i }).click();
    await expect(page.getByText(/^Nothing to restore/)).toBeVisible({ timeout: 10000 });
  });
});
