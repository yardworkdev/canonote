// @ts-check
import { test, expect } from '@playwright/test';

// The toolbar is the only way into most of what the app does, and it is the one
// surface whose shape depends on the window — and on the sidebar, which takes
// 208px of bar with it. The bar measures itself rather than the viewport and
// hands whatever does not fit to its overflow menu, so these specs hold it to
// the invariant that matters: no control is ever clipped, and every control is
// reachable at every width.

const editor = (page) => page.locator('textarea[aria-label="Note editor"]').first();

// Hover help is a portal tooltip now, not a `title` attribute: hover the control
// and read the line it shows. A disabled control gets the hover through its
// wrapper, which is exactly the case `title` could never cover.
const tooltipText = async (page, locator) => {
  await locator.hover({ force: true });
  const tip = page.getByRole('tooltip').first();
  await expect(tip).toBeVisible({ timeout: 5000 });
  const text = (await tip.innerText()).trim();
  await page.mouse.move(4, 4);
  await expect(page.getByRole('tooltip')).toHaveCount(0, { timeout: 5000 });
  return text;
};

const openFresh = async (page, width) => {
  if (width) await page.setViewportSize({ width, height: 720 });
  await page.goto('/app');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(editor(page)).toBeVisible({ timeout: 15000 });
  if (width && width < 768) {
    // Below `md` the notes sidebar is a drawer with a scrim over the page, so
    // the editor is not clickable until it is dismissed. The preference is how
    // the app remembers the choice.
    await page.evaluate(() => localStorage.setItem('sidebar-open', 'false'));
    await page.reload();
    await expect(editor(page)).toBeVisible({ timeout: 15000 });
  }
  await page.waitForTimeout(2500);
};

// A control that runs under the right-hand cluster is a control nobody can hit:
// the scroller clips it and its scrollbar is hidden. This is the check the old
// `hidden md:inline-flex` rule failed at 1280 with the sidebar open.
const clippedControls = (page) =>
  page.evaluate(() => {
    const bar = document.querySelector('div.sticky.top-0');
    const row = bar?.firstElementChild;
    const [scroller, cluster] = row ? [...row.children] : [];
    if (!scroller || !cluster) return ['no toolbar found'];
    const clusterLeft = cluster.getBoundingClientRect().left;
    return [...scroller.querySelectorAll('button')]
      .map((button) => ({
        label: button.getAttribute('aria-label'),
        box: button.getBoundingClientRect(),
      }))
      .filter(({ box }) => box.width > 0 && box.right > clusterLeft + 0.5)
      .map(({ label }) => label);
  });

const expectNothingClipped = async (page) => {
  expect(await clippedControls(page)).toEqual([]);
};

test.describe('Toolbar', () => {
  test('names each family of controls as its own group', async ({ page }) => {
    await openFresh(page);

    // `exact` matters: the group names are substrings of each other ("Notebook",
    // "Note actions"), and getByRole matches names as substrings by default.
    for (const name of [
      'Text formatting',
      'Lists',
      'Blocks',
      'Notebook',
      'Note actions',
      'Panels',
    ]) {
      await expect(page.getByRole('group', { name, exact: true })).toBeVisible();
    }

    const formatting = page.getByRole('group', { name: 'Text formatting' });
    await expect(formatting.getByRole('button', { name: 'Bold' })).toBeVisible();
    await expect(formatting.getByRole('button', { name: 'Strikethrough' })).toBeVisible();
  });

  test('a tooltip states the shortcut the control really answers to', async ({ page }) => {
    await openFresh(page);

    // Ctrl+B is wired in `useEditorPane.handleLocalKeyDown`; the same key is
    // announced to assistive tech through aria-keyshortcuts.
    const bold = page.getByRole('button', { name: 'Bold' });
    await expect(bold).toHaveAttribute('aria-keyshortcuts', 'Control+B Meta+B');
    expect(await tooltipText(page, bold)).toBe('Bold (Cmd/Ctrl+B)');

    // Strikethrough is Cmd/Ctrl+Shift+S, not the markdown it also accepts.
    expect(await tooltipText(page, page.getByRole('button', { name: 'Strikethrough' }))).toBe(
      'Strikethrough (Cmd/Ctrl+Shift+S)'
    );
    expect(await tooltipText(page, page.getByRole('button', { name: 'Task list' }))).toBe(
      'Task list (Markdown: - [ ])'
    );
  });

  test('copy and clear are disabled until the note has something in it', async ({ page }) => {
    await openFresh(page);

    const copy = page.getByRole('button', { name: 'Copy all content' });
    const clear = page.getByRole('button', { name: 'Clear all content' });

    await expect(copy).toBeDisabled();
    await expect(clear).toBeDisabled();
    // A disabled button answers no pointer events; its wrapper does, which is
    // the whole reason the tooltip replaced `title`.
    expect(await tooltipText(page, copy)).toBe('Copy all content — the note is empty');

    await editor(page).click();
    await page.keyboard.type('a line worth copying', { delay: 5 });

    await expect(copy).toBeEnabled();
    await expect(clear).toBeEnabled();
  });

  test('a phone width reaches the dropped controls through the overflow menu', async ({ page }) => {
    await openFresh(page, 375);

    // The bar itself drops the block controls at this width ...
    await expect(
      page.getByRole('group', { name: 'Blocks' }).getByRole('button', { name: 'Table' })
    ).toHaveCount(0);

    // ... and the menu is where they are.
    const trigger = page.getByRole('button', { name: 'More controls' });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.click();

    const menu = page.getByRole('menu', { name: 'More formatting and note actions' });
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    for (const name of ['Blockquote', 'Code block', 'Link', 'Horizontal rule', 'Table']) {
      await expect(menu.getByRole('menuitem', { name })).toBeVisible();
    }
    // Below `sm` the bar also drops the split view and the helper panel.
    await expect(menu.getByRole('menuitem', { name: 'Split editor' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Show helper panel' })).toBeVisible();

    // Anchored to the trigger but never off the edge of the phone.
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);

    await menu.getByRole('menuitem', { name: 'Table' }).click();

    // The control really ran, and the menu got out of the way.
    await expect(editor(page)).toHaveValue(/\| Column 1 \| Column 2 \| Column 3 \|/);
    await expect(menu).toBeHidden();
  });

  test('the overflow menu walks with the arrow keys and closes on Escape', async ({ page }) => {
    await openFresh(page, 375);

    const trigger = page.getByRole('button', { name: 'More controls' });
    await trigger.click();
    const menu = page.getByRole('menu', { name: 'More formatting and note actions' });

    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Blockquote' })).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Code block' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('every control stays reachable at any width', async ({ page }) => {
    // Inline while they fit, in the menu when they do not — the block controls
    // are never merely hidden. (Below ~1200px the bar's own essentials also
    // outgrow the strip and it scrolls; that is the shape it already had, and it
    // is why these five are the ones that get a menu home.)
    for (const width of [375, 1024, 1280, 1600]) {
      await openFresh(page, width);

      for (const name of ['Blockquote', 'Code block', 'Link', 'Horizontal rule', 'Table']) {
        const inline = page.getByRole('button', { name, exact: true });
        if (await inline.count()) {
          await expect(inline).toBeVisible();
          continue;
        }
        await page.getByRole('button', { name: 'More controls' }).click();
        await expect(
          page
            .getByRole('menu', { name: 'More formatting and note actions' })
            .getByRole('menuitem', { name })
        ).toBeVisible();
        await page.keyboard.press('Escape');
      }
    }
  });

  test('no control is clipped once the bar has room for its own essentials', async ({ page }) => {
    // 1280 with the notes sidebar open is the case the old breakpoint got wrong:
    // the sidebar takes 208px of bar, so the last block controls ran under the
    // right-hand cluster — invisible and unclickable, with no scrollbar to hint
    // at them. The bar now measures itself and hands them to the menu instead.
    for (const width of [1280, 1440, 1600]) {
      await openFresh(page, width);
      await expectNothingClipped(page);
    }
  });

  test('a window with room keeps the block controls inline, with no menu button', async ({
    page,
  }) => {
    await openFresh(page, 1600);

    for (const name of ['Blockquote', 'Code block', 'Link', 'Horizontal rule', 'Table']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'More controls' })).toBeHidden();
    await expectNothingClipped(page);
  });

  test('a phone width keeps the note actions in the menu rather than off the bar', async ({
    page,
  }) => {
    await openFresh(page, 375);

    // The bar drops them below `sm`; the menu is where they went.
    const trigger = page.getByRole('button', { name: 'More controls' });
    await trigger.click();
    const menu = page.getByRole('menu', { name: 'More formatting and note actions' });

    await expect(menu.getByRole('menuitem', { name: 'Copy all content' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Export note' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Clear all content' })).toBeVisible();

    // An empty note still has nothing to copy, wherever the control is drawn.
    await expect(menu.getByRole('menuitem', { name: 'Copy all content' })).toBeDisabled();

    // Typing into the note closes the menu (it is outside), so reopen it.
    await page.keyboard.press('Escape');
    await editor(page).click();
    await page.keyboard.type('a line worth copying', { delay: 5 });
    await trigger.click();

    await expect(menu.getByRole('menuitem', { name: 'Copy all content' })).toBeEnabled();
  });
});
