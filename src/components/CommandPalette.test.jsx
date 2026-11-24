import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CommandPalette from './CommandPalette';

describe('CommandPalette', () => {
  it('exposes find and replace from the search query', () => {
    const onClose = vi.fn();
    const onOpenFindReplace = vi.fn();

    render(
      <CommandPalette
        notes={[]}
        onClose={onClose}
        onCreateNote={vi.fn()}
        onOpenFindReplace={onOpenFindReplace}
        onSwitchNote={vi.fn()}
        onToggleTheme={vi.fn()}
        onToggleHelperView={vi.fn()}
        onToggleAIMenu={vi.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/type a command, heading or note/i), {
      target: { value: 'find' },
    });

    fireEvent.click(screen.getByRole('option', { name: /open find & replace/i }));

    expect(onOpenFindReplace).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
