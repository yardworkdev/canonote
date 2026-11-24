// @ts-check
import { test, expect } from '@playwright/test';

// The editor's chrome: the quiet status row under the note and the bubble menu
// that opens on a selection.
//
// Both hang off one subscription — the textarea's own select/keyup/mouseup
// events, read by `useEditorPane` — and both were dead in the real app for
// weeks without a spec noticing: the app renders "Opening your workspace…"
// until storage is open and auth has settled, so an editor element does not
// exist at the first commit, and the subscribe-once effect returned before it
// ever listened. Nothing typed at the caret was ever reported, so the readout
// never appeared and selecting text never opened the bubble. These specs
// exercise the app through its own boot, which is the only path that catches it.

const editor = (page) => page.locator('textarea[aria-label="Note editor"]').first();
const createNote = (page) => page.getByRole('button', { name: /create (new )?note/i }).first();
const readout = (page) => page.getByTitle('Where the caret is');
const bubble = (page) => page.getByRole('toolbar', { name: 'Selection actions' });

const openFresh = async (page) => {
  await page.goto('/app');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(editor(page)).toBeVisible({ timeout: 15000 });
  // The app settles its load (notes cache, current id) after first paint.
  await page.waitForTimeout(2500);
};

test.beforeEach(async ({ page }) => {
  await openFresh(page);
});

test.describe('Editor chrome', () => {
  test('the status row shows where the caret is, and follows it', async ({ page }) => {
    // Nothing to report before the editor has been used — and note that a click
    // into the editor is already "used": it reports the caret it lands on.
    await expect(readout(page)).toHaveCount(0);

    await createNote(page).click();
    await editor(page).click();

    await page.keyboard.type('# Title\n\nbody line', { delay: 10 });
    // Typed to the end of the third line: 'body line' is 9 characters long.
    await expect(readout(page)).toHaveText('· Ln 3, Col 10');

    await page.keyboard.press('Control+Home');
    await expect(readout(page)).toHaveText('· Ln 1, Col 1');

    // Line 3 is 'body line'; the arrow keys land on its first column, End on
    // its last.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(readout(page)).toHaveText('· Ln 3, Col 1');

    await page.keyboard.press('End');
    await expect(readout(page)).toHaveText('· Ln 3, Col 10');
  });

  test('selecting text opens the bubble menu, and the caret readout keeps up', async ({ page }) => {
    await createNote(page).click();
    await editor(page).click();
    await page.keyboard.type('# Title\n\nbody line', { delay: 10 });

    await expect(bubble(page)).toHaveCount(0);
    await page.keyboard.press('Control+a');
    await expect(bubble(page)).toBeVisible();
    // A selection reports its end — where the next keystroke would land.
    await expect(readout(page)).toHaveText('· Ln 3, Col 10');
    await expect(bubble(page).getByRole('button', { name: 'Bold' })).toBeVisible();
  });

  test('the readout counts the note it is in, not the note it was in', async ({ page }) => {
    await createNote(page).click();
    await editor(page).click();
    await page.keyboard.type('# Title\n\nbody line', { delay: 10 });
    await expect(readout(page)).toHaveText('· Ln 3, Col 10');

    // A second note: the status row belongs to whichever note is open. Wait for
    // the new note's own load to land (an empty editor is the app's signal, not
    // a sleep) before typing — otherwise the load can arrive mid-keystroke and
    // put the caret back at the start, which is what this spec is about.
    await createNote(page).click();
    await expect(editor(page)).toHaveValue('');
    await editor(page).click();
    await page.keyboard.type('one line', { delay: 10 });
    await expect(readout(page)).toHaveText('· Ln 1, Col 9');
  });
});
