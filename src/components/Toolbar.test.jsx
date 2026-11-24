import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Toolbar from './Toolbar';
import { blocksNeedMenu } from './toolbar-controls';

// The bar describes each control once and renders it wherever it fits — inline,
// or in the overflow menu at a width that cannot hold it. These specs hold the
// two placements to the same definitions, and hold the disabled states to the
// note they are about.
//
// `vitest.config.js` loads no React plugin, so JSX here compiles with esbuild's
// classic runtime: the React import above is required, not decorative.

const activeFormats = { bold: false, italic: false, underline: false, strike: false };

const setup = (props = {}) => {
  const handlers = {
    onFormat: vi.fn(),
    onInsertHeading: vi.fn(),
    onInsertBlockquote: vi.fn(),
    onInsertCodeBlock: vi.fn(),
    onInsertLink: vi.fn(),
    onInsertNumberedList: vi.fn(),
    onInsertTaskList: vi.fn(),
    onInsertHorizontalRule: vi.fn(),
    onInsertTable: vi.fn(),
    onInsertBulletList: vi.fn(),
    onCopy: vi.fn(),
    onClear: vi.fn(),
    onExport: vi.fn(),
    onCreateNote: vi.fn(),
    onToggleSidebar: vi.fn(),
    onToggleHelperView: vi.fn(),
    onToggleSplitView: vi.fn(),
    onAIClick: vi.fn(),
    onLogout: vi.fn(),
  };

  const utils = render(
    <Toolbar
      activeFormats={activeFormats}
      content=""
      sidebarOpen
      showHelperView={false}
      splitViewEnabled={false}
      isLocalMode
      {...handlers}
      {...props}
    />
  );

  return { ...utils, handlers };
};

const openOverflow = () => {
  fireEvent.click(screen.getByRole('button', { name: 'More controls' }));
};

// Hover help moved from native `title` attributes to the Tooltip component, so
// the assertions move with it: hover the control and read what it says.
const tooltip = async (button) => {
  // The handler is on the Tooltip wrapper, which is the element that gets the
  // pointer in the browser; a disabled inner button never receives one at all.
  fireEvent.mouseEnter(button.parentElement);
  const tip = await screen.findByRole('tooltip', {}, { timeout: 2000 });
  fireEvent.mouseLeave(button.parentElement);
  return tip.textContent;
};

describe('Toolbar', () => {
  it('names each family of controls as its own group', () => {
    setup();

    ['Text formatting', 'Lists', 'Blocks', 'Notebook', 'Note actions', 'Panels'].forEach((name) => {
      expect(screen.getByRole('group', { name })).toBeInTheDocument();
    });

    const formatting = screen.getByRole('group', { name: 'Text formatting' });
    expect(formatting).toContainElement(screen.getByRole('button', { name: 'Bold' }));
    expect(formatting).toContainElement(screen.getByRole('button', { name: 'Strikethrough' }));
  });

  it('states the shortcut a control really answers to, in the tooltip and to assistive tech', async () => {
    setup();

    const bold = screen.getByRole('button', { name: 'Bold' });
    expect(bold).toHaveAttribute('aria-keyshortcuts', 'Control+B Meta+B');
    expect(await tooltip(bold)).toBe('Bold (Cmd/Ctrl+B)');

    // The strikethrough shortcut is the one `handleLocalKeyDown` answers to, not
    // the markdown someone could also type.
    expect(await tooltip(screen.getByRole('button', { name: 'Strikethrough' }))).toBe(
      'Strikethrough (Cmd/Ctrl+Shift+S)'
    );

    // No shortcut exists for these, so the tooltip offers the markdown instead.
    expect(await tooltip(screen.getByRole('button', { name: 'Blockquote' }))).toBe(
      'Blockquote (Markdown: >)'
    );
  });

  it('disables the controls that would act on text that is not there', async () => {
    const { unmount } = setup({ content: '' });

    expect(screen.getByRole('button', { name: 'Copy all content' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear all content' })).toBeDisabled();
    // A disabled control is exactly where a person needs the reason, and a
    // disabled button answers no pointer events — the wrapper carries the hover.
    expect(await tooltip(screen.getByRole('button', { name: 'Copy all content' }))).toBe(
      'Copy all content — the note is empty'
    );
    // Export is not one of them: an empty note is still a note, and the file is
    // the point.
    expect(screen.getByRole('button', { name: 'Export note' })).toBeEnabled();

    unmount();
    setup({ content: 'a line of the note' });

    expect(screen.getByRole('button', { name: 'Copy all content' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Clear all content' })).toBeEnabled();
  });

  it('offers the panel toggles the bar drops inside the overflow menu, and runs them', () => {
    // jsdom lays nothing out, so the bar measures zero and stays in its full
    // shape — the block controls are inline here and the menu carries the two
    // toggles the bar hides below `sm`. The measured case (block controls in the
    // menu) is the e2e's, where there is a real layout to measure.
    const { handlers } = setup();

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    openOverflow();

    const menu = screen.getByRole('menu', { name: 'More formatting and note actions' });
    expect(screen.getByRole('button', { name: 'More controls' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );

    expect(menu).toContainElement(screen.getByRole('menuitem', { name: 'Split editor' }));
    expect(menu).toContainElement(screen.getByRole('menuitem', { name: 'Show helper panel' }));
    // The note actions the bar drops below `sm` are here too, and they carry
    // their disabled state with them: an empty note has nothing to copy.
    expect(menu).toContainElement(screen.getByRole('menuitem', { name: 'Copy all content' }));
    expect(screen.getByRole('menuitem', { name: 'Copy all content' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Clear all content' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Export note' })).toBeEnabled();
    // The block controls are in the bar itself, not duplicated in the menu.
    expect(screen.getByRole('button', { name: 'Table' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Table' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Show helper panel' }));

    expect(handlers.onToggleHelperView).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('walks the menu with the arrow keys and closes on Escape, handing focus back', () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'More controls' });

    openOverflow();

    // Arrow keys skip what cannot be used: the first reachable item is Export,
    // because Copy and Clear are disabled on an empty note.
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Export note' }));

    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Split editor' }));

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('offers the sign-in that agents need instead of hiding the button', () => {
    // Device-only mode has no account, so there is no panel to open. The button
    // used to vanish, which left no way from the notebook to the sign-in form.
    const onSignInToUseAgents = vi.fn();
    setup({ onSignInToUseAgents, onOpenAgents: vi.fn() });

    const signIn = screen.getByRole('button', { name: 'Sign in to use agents' });
    fireEvent.click(signIn);

    expect(onSignInToUseAgents).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Open agents' })).not.toBeInTheDocument();
  });

  it('decides the overflow from the bar it measured, not from the window', () => {
    // The rule behind the layout effect, held on its own because jsdom cannot
    // lay anything out. A 1280px window with the sidebar open has 587px of bar
    // and the full set needs 662 — that is the case the old breakpoint clipped.
    expect(blocksNeedMenu(662, 587)).toBe(true);
    expect(blocksNeedMenu(662, 900)).toBe(false);
    // In the menu the same bar holds everything but the block controls (429),
    // and their measured width comes back on top of that.
    expect(blocksNeedMenu(429 + 235, 587)).toBe(true);
    expect(blocksNeedMenu(429 + 235, 700)).toBe(false);
    // A control that ends flush with the edge is not reachable.
    expect(blocksNeedMenu(660, 662)).toBe(true);
  });
});
