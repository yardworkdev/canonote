// @ts-check
import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

// End-to-end coverage of the notebook as it works today: local-first, no
// account, no backend. These replace the TipTap-era specs, which waited on a
// `.ProseMirror` editor and a sign-in flow that no longer exist.

const editor = (page) => page.locator('textarea[aria-label="Note editor"]').first();
const sidebar = (page) => page.locator('aside, nav').first();

test.beforeEach(async ({ page }) => {
  await page.goto('/app');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(editor(page)).toBeVisible({ timeout: 15000 });
});

test.describe('Local notebook', () => {
  test('opens straight into the editor with no sign-in', async ({ page }) => {
    await expect(editor(page)).toBeVisible();
    await expect(page.getByText(/unlock your workspace|supabase is not configured/i)).toHaveCount(0);
    // The session is a local one, not a cloud account, and the notebook says so
    // as status text — never as a control that does nothing (dogfood 2026-10-07,
    // "the Local chip reads like a button").
    const storageFact = page.getByText('Stored in this browser');
    await expect(storageFact).toBeVisible();
    expect(await storageFact.evaluate((el) => el.closest('button, [role="button"]'))).toBeNull();
  });

  test('creates a note, types markdown and keeps it across a reload', async ({ page }) => {
    await page.getByRole('button', { name: /create note/i }).first().click();
    const text = `# Persisted note\n\nbody text ${Date.now()}`;
    await editor(page).click();
    await page.keyboard.type(text, { delay: 5 });

    await expect(page.getByText(/\d+ words/)).toBeVisible();
    await page.waitForTimeout(2500); // autosave debounce
    await page.reload();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });

    await expect(editor(page)).toHaveValue(text);
    // The title comes from the markdown, without its heading marker.
    await expect(page.getByText('Persisted note', { exact: true }).first()).toBeVisible();
  });

  test('the note list row carries title, recency and labelled actions', async ({ page }) => {
    await page.getByRole('button', { name: /create note/i }).first().click();
    await editor(page).click();
    await page.keyboard.type('# Row anatomy', { delay: 5 });
    await page.waitForTimeout(2500);

    const row = page.getByRole('button', { name: /Open note: Row anatomy/ }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('Row anatomy');
    // Recency is always visible now, not only when a search has no snippet.
    await expect(row).toContainText(/just now|min ago/);
    // Both row actions exist and are named for screen readers, even while hidden.
    await expect(page.getByLabel('Delete note: Row anatomy')).toBeAttached();
    await expect(page.getByLabel('Pin note: Row anatomy')).toBeAttached();
  });

  test('keeps a note typed into on open, without creating one first', async ({ page }) => {
    // The reported P0: the app opens on a placeholder editor, not on a note.
    // Typing there used to save nothing on a timer, so a reload lost the text.
    const text = `# Typed on open\n\nno create button pressed ${Date.now()}`;

    await editor(page).click();
    await page.keyboard.type(text, { delay: 5 });
    await expect(page.getByText(/\d+ words/)).toBeVisible();

    // It is materialised into the list without pressing "create note".
    const row = page.getByRole('button', { name: /Open note: Typed on open/ }).first();
    await expect(row).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2500); // autosave debounce

    await page.reload();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });
    await expect(editor(page)).toHaveValue(text);

    // Selecting the row must load its content, not leave the editor empty.
    await page.getByRole('button', { name: /Open note: Typed on open/ }).first().click();
    await expect(editor(page)).toHaveValue(text);
  });

  test('shows the agent section under the name the user chose', async ({ page }) => {
    // The roadmap item: an agent identity the user defines, with no built-in
    // name. Seed an agent-written note and the user's chosen name, then reload.
    // The note goes through the seam (IndexedDB); the name is a preference and
    // stays in Web Storage.
    //
    // The seed goes in behind the app, so first wait for the app's own boot load
    // to finish — the sidebar's empty state is its signal. A seed that lands
    // mid-load can be overtaken by the load's own view of the notebook.
    await expect(page.getByText('No notes yet')).toBeVisible({ timeout: 15000 });

    await page.evaluate(async () => {
      localStorage.setItem('agent-name', 'Notetaker');
      await window.storage.set(
        'local:notes-cache',
        JSON.stringify([
          {
            id: 'note-agent-seeded',
            title: 'Agent note',
            folder: 'agent',
            createdBy: 'agent_notetaker',
            createdByName: null,
            updatedBy: 'agent_notetaker',
            updated: Date.now(),
            isPinned: false,
          },
        ])
      );
      await window.storage.set('local:note-agent-seeded', '# Agent note\n\nwritten by the agent');
    });
    await page.reload();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });

    // The row says whose note it is in one word. The agent's display name lives
    // in the helper panel and the presence line; a sidebar row has no space for a
    // sentence, and an earlier version of this test asserted a sentence.
    const row = page.getByRole('button', { name: /Open note: Agent note/ }).first();
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(row.getByText('agent', { exact: true })).toBeVisible();
    await expect(row.getByText('you', { exact: true })).toHaveCount(0);
  });

  // The agent's name is set in the collaboration panel, which needs a cloud
  // backend; a local notebook has no agent UI at all (the toolbar hides it for
  // exactly that reason). The name's storage round trip is covered by
  // useAgentName.test.js and by the sidebar test above.
  test.skip('names the agent from the settings field, and the name survives a reload', async ({ page }) => {
    // The name is a user setting, not a constant: set it in the UI, then read it
    // back from a fresh load of the app.
    // The name lives in the collaboration panel now: it is where the agent stops
    // being anonymous — connections, attribution and the presence line all read it.
    const openSettings = async () => {
      const panel = page.getByLabel('Agent name');
      if (await panel.count()) return;
      await page.getByLabel('Open agents').click();
    };

    await openSettings();
    const field = page.getByLabel('Agent name');
    await expect(field).toBeVisible({ timeout: 5000 });
    await field.fill('Sidekick');
    await field.blur();

    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('agent-name')))
      .toBe('Sidekick');

    await page.reload();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });
    await openSettings();
    await expect(page.getByLabel('Agent name')).toHaveValue('Sidekick');
  });

  test('finds a note by text in its body', async ({ page }) => {
    const marker = `zebra${Date.now().toString().slice(-6)}`;
    await page.getByRole('button', { name: /create note/i }).first().click();
    await editor(page).click();
    await page.keyboard.type(`# Searchable\n\ncontains ${marker} marker`, { delay: 5 });
    await page.waitForTimeout(2500);

    await page.getByLabel('Search notes').fill(marker);
    await expect(page.getByText('Searchable', { exact: true }).first()).toBeVisible({ timeout: 5000 });
  });

  test('deletes a note and does not bring it back on reload', async ({ page }) => {
    await page.getByRole('button', { name: /create note/i }).first().click();
    await editor(page).click();
    await page.keyboard.type('# Doomed note', { delay: 5 });
    // The row takes its title from the committed content, so waiting for the
    // row is waiting for the save — a fixed wait raced the asynchronous store.
    await expect(page.getByRole('button', { name: /Open note: Doomed note/ })).toBeVisible({
      timeout: 15000,
    });

    await page.getByLabel('Delete note: Doomed note').click();
    // The confirmation is queued, so it appears a tick after the click.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.getByRole('button', { name: /^delete$/i }).click();
    await page.waitForTimeout(1500);

    await expect(page.getByRole('button', { name: /Open note: Doomed note/ })).toHaveCount(0);
    await page.reload();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /Open note: Doomed note/ })).toHaveCount(0);
  });

  test('imports a markdown file chosen from disk', async ({ page }) => {
    const title = '# Brought in from a file';
    await page.getByLabel('Import markdown or zip file').setInputFiles({
      name: 'imported-note.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(`${title}\n\nbody brought in from a file.`),
    });

    // The note lands in the list and its content loads in the editor — an
    // import that only adds a row would still be a lost note.
    const row = page.getByRole('button', { name: /Open note: Brought in from a file/ }).first();
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(editor(page)).toHaveValue(`${title}\n\nbody brought in from a file.`);
  });

  test('imports a zip export and does not duplicate on re-import', async ({ page }) => {
    const zip = new JSZip();
    zip.folder('notes').file('Zip One.md', '# Zip One\n\nfirst body');
    zip.folder('notes').file('Zip Two.md', '# Zip Two\n\nsecond body');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    const input = page.getByLabel('Import markdown or zip file');
    await input.setInputFiles({ name: 'notes-export.zip', mimeType: 'application/zip', buffer });
    await expect(page.getByRole('button', { name: 'Open note: Zip One' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Open note: Zip Two' })).toBeVisible();

    // Re-importing the same archive must not duplicate the notebook.
    await input.setInputFiles({ name: 'notes-export.zip', mimeType: 'application/zip', buffer });
    await page.waitForTimeout(1000);
    await expect(page.getByRole('button', { name: 'Open note: Zip One' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Open note: Zip Two' })).toHaveCount(1);
  });

  test('opens the command palette with Ctrl+K', async ({ page }) => {
    await page.locator('body').click();
    await page.keyboard.press('Control+k');
    await expect(page.getByPlaceholder(/type a command/i)).toBeVisible({ timeout: 5000 });
  });

  test('opens the export dialog from the toolbar', async ({ page }) => {
    await page.getByLabel('Export note').click();
    await expect(page.getByText(/markdown|plain text|print/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('dismisses its dialogs with Escape', async ({ page }) => {
    // The export dialog: Escape and a backdrop click must both close it, or the
    // backdrop swallows every later click.
    const exportDialog = page.getByRole('dialog', { name: 'Export note' });
    await page.getByLabel('Export note').click();
    await expect(exportDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(exportDialog).toHaveCount(0);

    await page.getByLabel('Export note').click();
    await expect(exportDialog).toBeVisible();
    await page.mouse.click(20, 20);
    await expect(exportDialog).toHaveCount(0);

    // Find & replace: Escape must still work after a click inside the panel
    // moves focus off it.
    await page.locator('body').click();
    await page.keyboard.press('Control+f');
    const findField = page.getByLabel('Find text');
    await expect(findField).toBeVisible({ timeout: 5000 });
    await findField.fill('note');
    await page.getByRole('button', { name: /replace all/i }).click();
    await page.keyboard.press('Escape');
    await expect(findField).toHaveCount(0);
  });

  test('records version history and restores an earlier version', async ({ page }) => {
    const first = '# Draft one\n\n' + 'First version of the note. '.repeat(8);
    const second = '# Draft two\n\n' + 'Second version, longer and rewritten. '.repeat(16);

    await page.getByRole('button', { name: /create note/i }).first().click();
    await editor(page).click();
    await editor(page).fill(first);
    // Wait for each save to commit — the row takes its title from the committed
    // content, so the row is the app's own signal. Sleeping instead let a
    // pending save land after the restore and put the old text back on screen.
    await expect(page.getByRole('button', { name: /Open note: Draft one/ })).toBeVisible({
      timeout: 15000,
    });
    await editor(page).fill(second);
    await expect(page.getByRole('button', { name: /Open note: Draft two/ })).toBeVisible({
      timeout: 15000,
    });

    await page.getByLabel(/Show helper panel/).click();
    await page.getByRole('tab', { name: 'History' }).click();

    const restores = page.getByTitle('Restore this version');
    await expect(restores.first()).toBeVisible({ timeout: 5000 });
    expect(await restores.count()).toBeGreaterThanOrEqual(2);

    await restores.last().click();
    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /^restore$/i }).click();
    await expect(editor(page)).toHaveValue(first, { timeout: 15000 });
  });

  test('shows no account controls in local mode', async ({ page }) => {
    // There is no account to sign out of, so a logout button would be a control
    // that does nothing — and the notebook states where the notes live as
    // status, not as a control.
    await page.getByRole('button', { name: /create note/i }).first().click();
    await expect(page.getByLabel('Logout')).toHaveCount(0);
    const storageFact = page.getByText('Stored in this browser');
    await expect(storageFact).toBeVisible();
    expect(await storageFact.evaluate((el) => el.closest('button, [role="button"]'))).toBeNull();
  });

  test('makes no failing network requests in local mode', async ({ page }) => {
    const failures = [];
    page.on('response', (r) => {
      if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
    });
    await page.getByRole('button', { name: /create note/i }).first().click();
    await editor(page).click();
    await page.keyboard.type('# Quiet\n\nno backend calls', { delay: 5 });
    await page.waitForTimeout(3000);
    expect(failures).toEqual([]);
  });
});
