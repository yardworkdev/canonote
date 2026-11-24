// @ts-check
import { test, expect } from '@playwright/test';

// The second store behind the seam: a folder the user picks, where every note
// is a real `.md` file.
//
// The picker itself cannot be driven — `showDirectoryPicker` needs a human and
// a gesture — so the spec points the app at a **real directory handle** the
// browser hands out without a picker: the origin private file system. Same
// interface, same `getFileHandle`/`createWritable`/`removeEntry`/`entries`
// calls, same handle object, and it is the app's own code that runs on it. What
// the spec proves is therefore the wiring and the file mapping, not the picker:
// notes really land in the directory as markdown, a file put there by another
// tool really opens in the notebook, and leaving the folder really leaves the
// files where they are.

const FOLDER = 'notes-folder';

const editor = (page) => page.locator('textarea[aria-label="Note editor"]').first();
const paletteInput = (page) => page.getByPlaceholder(/type a command/i);

/** A real directory handle, without a picker: OPFS behind the same API. */
const stubFolderPicker = (page, folderName = FOLDER) =>
  page.addInitScript(async (name) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      return root.getDirectoryHandle(name, { create: true });
    };
  }, folderName);

const folderDirectory = async (page, folderName = FOLDER) =>
  page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    await root.getDirectoryHandle(name, { create: true });
    return true;
  }, folderName);

const listFolder = (page, folderName = FOLDER) =>
  page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(name);
    const names = [];
    for await (const [entryName, handle] of directory.entries()) {
      if (handle.kind === 'file') names.push(entryName);
    }
    return names.sort();
  }, folderName);

const readFolderFile = (page, fileName, folderName = FOLDER) =>
  page.evaluate(
    async ([name, file]) => {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle(name);
      const handle = await directory.getFileHandle(file);
      return (await handle.getFile()).text();
    },
    [folderName, fileName]
  );

/**
 * The file's text, or `null` while it is not there yet. Reading a file while the
 * app is writing it can throw (`NotFoundError` before it exists,
 * `NotReadableError` mid-write), and a poll that throws fails instead of
 * retrying — so the poll asks this, not `readFolderFile`.
 */
const folderFileOrNull = async (page, fileName, folderName = FOLDER) => {
  try {
    return await readFolderFile(page, fileName, folderName);
  } catch {
    return null;
  }
};

const writeFolderFile = (page, fileName, text, folderName = FOLDER) =>
  page.evaluate(
    async ([name, file, contents]) => {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle(name, { create: true });
      const handle = await directory.getFileHandle(file, { create: true });
      const writable = await handle.createWritable();
      await writable.write(contents);
      await writable.close();
      return true;
    },
    [folderName, fileName, text]
  );

const openStoragePanel = async (page) => {
  await page.locator('body').click();
  await page.keyboard.press('Control+k');
  await expect(paletteInput(page)).toBeVisible({ timeout: 5000 });
  await paletteInput(page).fill('storage');
  await page.getByRole('option', { name: /storage health/i }).click();
  await expect(page.getByRole('dialog', { name: 'Storage' })).toBeVisible({ timeout: 5000 });
};

/** Connect the folder from the panel and wait for the notebook to come back on it. */
const connectFolder = async (page) => {
  await openStoragePanel(page);
  await page.getByRole('button', { name: /use a folder for your notes/i }).click();
  await expect(page.getByText(/Your notes are \.md files in/)).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(`Stored in “${FOLDER}”`)).toBeVisible({ timeout: 15000 });
  await expect(editor(page)).toBeVisible({ timeout: 15000 });
};

test.describe('a folder the user picks', () => {
  test.beforeEach(async ({ page }) => {
    await stubFolderPicker(page);
    await page.goto('/app');
    await page.evaluate(() => localStorage.clear());
    await folderDirectory(page);
    await page.reload();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });
  });

  test('stores every note as one markdown file in that folder', async ({ page }) => {
    await connectFolder(page);

    await editor(page).click();
    await page.keyboard.type('# Alpha\n\nthe body of the note', { delay: 5 });

    // The file is the truth, so wait for the file and not for the app's `Saved`
    // status: that is a one-second pulse, and under load a save lands while the
    // typing is still going, so a polling assertion can catch it mid-note.
    await expect
      .poll(() => folderFileOrNull(page, 'alpha.md'), { timeout: 20000 })
      .toBe('# Alpha\n\nthe body of the note');

    expect(await listFolder(page)).toContain('alpha.md');

    // The folder is the store: a reload reads the note back from the file.
    await page.reload();
    const row = page.getByLabel(/^Open note: Alpha$/);
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.click();
    await expect(editor(page)).toHaveValue(/the body of the note/, { timeout: 10000 });
    await expect(page.getByText(`Stored in “${FOLDER}”`)).toBeVisible();

    // One note, one file, one row: a save that overlaps the orphan scan must not
    // leave a second note behind (two rows with the same title, one file empty).
    // Only the notes are asserted exactly: while the sidecar is being written,
    // Chromium leaves its own `.canonote.json.crswap` beside it.
    const folderFiles = await listFolder(page);
    expect(folderFiles.filter((name) => /\.md$/i.test(name))).toEqual(['alpha.md']);
    expect(folderFiles).toContain('.canonote.json');
    await expect(page.getByLabel(/^Open note: Alpha$/)).toHaveCount(1);
    expect(await readFolderFile(page, 'alpha.md')).toBe('# Alpha\n\nthe body of the note');
  });

  test('opens a note that was written in the folder by another tool', async ({ page }) => {
    await connectFolder(page);
    await writeFolderFile(page, 'bought by hand.md', 'A note written in another editor');

    await page.reload();

    const row = page.getByLabel(/^Open note: A note written in another editor$/);
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.click();
    await expect(editor(page)).toHaveValue('A note written in another editor', { timeout: 10000 });
  });

  test('leaves the files where they are when the notebook goes back to the browser', async ({
    page,
  }) => {
    await connectFolder(page);
    await editor(page).click();
    await page.keyboard.type('# Alpha\n\nthe body of the note', { delay: 5 });
    await expect
      .poll(() => folderFileOrNull(page, 'alpha.md'), { timeout: 20000 })
      .toBe('# Alpha\n\nthe body of the note');

    await openStoragePanel(page);
    await page.getByRole('button', { name: /back to this browser/i }).click();
    await expect(page.getByText(/The notebook is back in this browser/)).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText('Stored in this browser')).toBeVisible({ timeout: 15000 });

    // Nothing was moved or deleted: the notebook starts empty and the file stays.
    expect(await listFolder(page)).toContain('alpha.md');
    expect(await readFolderFile(page, 'alpha.md')).toBe('# Alpha\n\nthe body of the note');
    await expect(page.getByLabel(/^Open note: Alpha$/)).toHaveCount(0);
  });
});
