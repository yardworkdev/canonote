import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ThemeSwitcher from './ThemeSwitcher';

// Three themes that all looked grey made the control look broken: choosing one
// changed nothing you could see (Ves, 2026-11-18). Two themes, and each one has
// to be visibly its own thing.
describe('the theme switcher', () => {
  it('offers exactly two themes, and aurora is gone', () => {
    render(<ThemeSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: /change theme/i }));
    const items = screen.getAllByRole('menuitemradio');
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Midnight'),
      expect.stringContaining('Sepia'),
    ]);
    expect(screen.queryByText(/aurora/i)).not.toBeInTheDocument();
  });

  it('applies the chosen theme to the document and remembers it', () => {
    render(<ThemeSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: /change theme/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /sepia/i }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'sepia');
    // test-setup replaces localStorage with spies, so this asserts the write
    // itself instead of a read that a mock cannot answer.
    expect(window.localStorage.setItem).toHaveBeenCalledWith('app-theme', 'sepia');
  });
});
