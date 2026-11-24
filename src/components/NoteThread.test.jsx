import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NoteThread from './NoteThread';

// The panel is the visible half of the promise "an agent proposes, a person
// applies". These tests are about what it will not do: it must not offer Apply
// for its own messages, must not silently swallow a stale proposal, and must not
// look broken when there is no server.

const agent = (over = {}) => ({
  id: 'm1',
  noteId: 'n1',
  authorType: 'agent',
  authorName: 'Promi',
  kind: 'note',
  body: 'Is the closing paragraph right?',
  baseRevision: null,
  createdAt: new Date().toISOString(),
  appliedAt: null,
  decidedAt: null,
  ...over,
});

const props = (over = {}) => ({
  noteId: 'n1',
  messages: [],
  status: 'ready',
  notice: null,
  onPost: vi.fn(),
  onDecide: vi.fn(),
  onApply: vi.fn(),
  onNotice: vi.fn(),
  baseRevision: 3,
  ...over,
});

describe('the thread panel', () => {
  // Ves, 2026-11-18: an agent's words have to be a different thing on screen, not
  // the same bubble with a name inside it. The classes are the contract the theme
  // uses to paint that, so they are asserted here rather than trusted.
  it('marks an agent message as its own surface and a person message as plain', () => {
    render(
      <NoteThread
        {...props({
          messages: [
            agent(),
            agent({ id: 'm2', authorType: 'human', authorName: null, body: 'Looks right to me.' }),
          ],
        })}
      />,
    );
    const [agentCard, humanCard] = document.querySelectorAll('.thread-message');
    expect(agentCard).toHaveAttribute('data-author', 'agent');
    expect(agentCard).toHaveClass('thread-message');
    expect(agentCard.querySelector('.thread-body')).toBeTruthy();
    expect(agentCard.querySelector('.thread-kind')).toHaveTextContent(/agent/i);
    expect(humanCard).toHaveAttribute('data-author', 'human');
    expect(humanCard.querySelector('.thread-kind')).toBeNull();
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('shows an agent message with the agent as its author, never as you', () => {
    render(<NoteThread {...props({ messages: [agent()] })} />);
    expect(screen.getByText('Promi')).toBeInTheDocument();
    expect(screen.queryByText('You')).not.toBeInTheDocument();
  });

  it('offers Apply only on a proposal', () => {
    render(<NoteThread {...props({ messages: [agent()] })} />);
    expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument();
  });

  it('applies a proposal through the editor and records the decision', async () => {
    const onApply = vi.fn().mockResolvedValue('applied');
    const onDecide = vi.fn().mockResolvedValue({});
    render(
      <NoteThread
        {...props({
          messages: [agent({ kind: 'proposal', baseRevision: 3, body: 'A suggested closing line.' })],
          onApply,
          onDecide,
        })}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith('m1', true));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
  });

  it('says so instead of pretending when the note has moved on', async () => {
    const onApply = vi.fn().mockResolvedValue('stale');
    const onDecide = vi.fn().mockResolvedValue({});
    const onNotice = vi.fn();
    render(
      <NoteThread
        {...props({
          messages: [agent({ kind: 'proposal', baseRevision: 2 })],
          onApply,
          onDecide,
          onNotice,
        })}
      />
    );
    // The panel admits the gap before anyone clicks anything.
    expect(screen.getByText(/written for revision 2/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('proposalAppliedStale'));
    expect(onDecide).toHaveBeenCalledWith('m1', false);
  });

  it('sends what was typed and clears the box', async () => {
    const onPost = vi.fn().mockResolvedValue({ id: 'm9' });
    render(<NoteThread {...props({ onPost })} />);
    const box = screen.getByLabelText(/message about this note/i);
    fireEvent.change(box, { target: { value: 'Can you tighten this?' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(onPost).toHaveBeenCalledWith('Can you tighten this?', { kind: 'note' }));
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('explains a local-only notebook instead of showing an empty thread', () => {
    render(<NoteThread {...props({ status: 'ready', notice: 'threadLocalOnly' })} />);
    expect(screen.getByText(/stored in this browser only/i)).toBeInTheDocument();
  });
});
