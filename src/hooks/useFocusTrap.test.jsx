import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useFocusTrap } from './useFocusTrap';

// The dialog contract lives in one hook, so it is tested in one place: focus
// moves in, Tab cycles inside, Escape closes, and the caret goes back to the
// control that opened the dialog. Every dialog in the app depends on all four.

function Dialog({ open = true, onClose = () => {}, withInitialFocus = false }) {
  const containerRef = React.useRef(null);
  const firstRef = React.useRef(null);
  useFocusTrap(containerRef, open, {
    onClose,
    initialFocusRef: withInitialFocus ? firstRef : undefined,
  });
  if (!open) return null;
  return (
    <div ref={containerRef} tabIndex={-1} role="dialog" aria-label="Test dialog">
      <button ref={firstRef}>first</button>
      <button>last</button>
    </div>
  );
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useFocusTrap', () => {
  it('moves focus into the dialog when it opens', () => {
    render(<Dialog />);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('takes the initial focus target when one is given', () => {
    render(<Dialog withInitialFocus />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }));
  });

  it('keeps Tab inside the dialog, both directions', () => {
    render(<Dialog />);
    const dialog = screen.getByRole('dialog');
    const first = screen.getByRole('button', { name: 'first' });
    const last = screen.getByRole('button', { name: 'last' });

    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes on Escape, wherever the focus sits', () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('gives the keyboard back to the control that opened it', () => {
    const opener = document.createElement('button');
    opener.textContent = 'open';
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { unmount } = render(<Dialog />);
    expect(document.activeElement).not.toBe(opener);

    act(() => unmount());
    expect(document.activeElement).toBe(opener);
  });

  it('does not steal focus while it is inactive', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    render(<Dialog open={false} />);
    expect(document.activeElement).toBe(opener);
  });
});
