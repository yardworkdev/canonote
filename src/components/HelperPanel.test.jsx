import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PanelHeader, PanelEmpty, PanelLoading, PanelError } from './HelperPanel';

// The four helper panels wear one header, one empty, one loading and one error.
// These pin the shapes, because the defect they replace was a panel whose
// wording varied and whose error state did not exist: a store read the browser
// refused rendered as "No versions saved yet", which is a claim, not a state.
describe('HelperPanel', () => {
  describe('the header', () => {
    it('states the panel fact and renders its controls', () => {
      render(
        <PanelHeader label="3 versions saved" action={<button type="button">Clear</button>}>
          <button type="button">Model</button>
        </PanelHeader>
      );

      expect(screen.getByText('3 versions saved')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Model' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    });

    it('renders nothing but the rule when a panel has no fact yet', () => {
      const { container } = render(<PanelHeader />);

      expect(container.firstChild).toBeTruthy();
      expect(container.textContent).toBe('');
    });
  });

  describe('the empty state', () => {
    it('is one line of text and an optional action', () => {
      const onAction = vi.fn();
      render(
        <PanelEmpty
          message="No headings found."
          action={
            <button type="button" onClick={onAction}>
              Add a heading
            </button>
          }
        />
      );

      expect(screen.getByText('No headings found.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Add a heading' }));
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  describe('the loading state', () => {
    it('announces what is being read', () => {
      render(<PanelLoading label="Reading this note's versions…" />);

      expect(screen.getByRole('status')).toHaveTextContent("Reading this note's versions…");
    });
  });

  describe('the error state', () => {
    it('says what happened, gives the detail and offers the step', () => {
      const onRetry = vi.fn();
      render(
        <PanelError
          message="This note's versions could not be read."
          detail="The browser refused to read them."
          onRetry={onRetry}
        />
      );

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent("This note's versions could not be read.");
      expect(alert).toHaveTextContent('The browser refused to read them.');

      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('offers no action when there is no step that can help', () => {
      render(<PanelError message="That version could not be deleted." />);

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.queryByRole('button')).toBeNull();
    });
  });
});
