import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import Tooltip from './Tooltip';

// The point of this component is that a person can find out what a button does
// without clicking it, including when the button is disabled. Both of those are
// worth a test because both are easy to break: a wrapper that swallows hover, or
// a tooltip that only renders for enabled children.

describe('Tooltip', () => {
  it('says nothing until it is hovered', () => {
    render(
      <Tooltip label="Bold (Ctrl+B)">
        <button type="button">B</button>
      </Tooltip>
    );

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('explains the control on hover', async () => {
    vi.useFakeTimers();
    render(
      <Tooltip label="Bold (Ctrl+B)">
        <button type="button">B</button>
      </Tooltip>
    );

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'B' }));
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByRole('tooltip')).toHaveTextContent('Bold (Ctrl+B)');
    vi.useRealTimers();
  });

  it('still explains a disabled control', () => {
    vi.useFakeTimers();
    const { container } = render(
      <Tooltip label="Nothing to format yet">
        <button type="button" disabled>
          B
        </button>
      </Tooltip>
    );

    // A disabled button receives no pointer events at all, so the sentence has to
    // come from the wrapper — which is the whole reason disabled controls can be
    // explained here and not with `title`.
    fireEvent.mouseEnter(container.firstChild);
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByRole('tooltip')).toHaveTextContent('Nothing to format yet');
    vi.useRealTimers();
  });
});
