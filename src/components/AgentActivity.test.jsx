import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AgentActivity from './AgentActivity';

/**
 * The panel's states, one spec each: the trail, nothing to read from, a read
 * that failed (with the retry the reader can actually use), and an empty trail.
 * `@testing-library/user-event` is not installed and must not be added, so
 * clicks are `fireEvent`.
 *
 * `read` is injected and must be a stable reference — the effect depends on it.
 */

const event = (overrides = {}) => ({
  eventId: 'e1',
  noteId: 'note-1',
  actorId: 'agent_rudi',
  actorType: 'agent',
  action: 'notes.update',
  metadata: { title: 'Morning pages' },
  createdAt: '2026-10-16T09:00:00.000Z',
  ...overrides,
});

const renderPanel = (read, props = {}) =>
  render(<AgentActivity isOpen onClose={() => {}} read={read} notes={[]} {...props} />);

describe('agent activity', () => {
  it('renders nothing while it is closed', () => {
    const read = vi.fn(async () => ({ ok: true, events: [] }));
    render(<AgentActivity isOpen={false} onClose={() => {}} read={read} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('shows the trail: what happened, to which note, by whom, when', async () => {
    const read = vi.fn(async () => ({
      ok: true,
      events: [
        event(),
        event({
          eventId: 'e2',
          action: 'notes.create',
          actorType: 'user',
          metadata: { title: 'Shopping' },
        }),
      ],
      hasMore: false,
    }));
    renderPanel(read);

    expect(await screen.findByText('Edited “Morning pages”')).toBeTruthy();
    expect(screen.getByText('by agent_rudi')).toBeTruthy();
    expect(screen.getByText('Created “Shopping”')).toBeTruthy();
    expect(screen.getByText('by you')).toBeTruthy();
    expect(screen.getByText(/Every note an agent creates or edits/)).toBeTruthy();
  });

  it('names a note it knows from the notebook when the event carries no title', async () => {
    const read = vi.fn(async () => ({
      ok: true,
      events: [event({ metadata: {} })],
      hasMore: false,
    }));
    renderPanel(read, { notes: [{ id: 'note-1', title: 'From the sidebar' }] });

    expect(await screen.findByText('Edited “From the sidebar”')).toBeTruthy();
  });

  it('says how many it is showing when the server has more', async () => {
    const read = vi.fn(async () => ({
      ok: true,
      events: [event(), event({ eventId: 'e2' })],
      hasMore: true,
    }));
    renderPanel(read);

    expect(await screen.findByText('Showing the newest 2 events.')).toBeTruthy();
  });

  it('says there is nothing to read from when no account is connected', async () => {
    const read = vi.fn(async () => ({ ok: false, events: [], notice: 'activityNoSession' }));
    renderPanel(read);

    expect(
      await screen.findByText('No account is connected, so there is no agent trail to read.')
    ).toBeTruthy();
    // An information state, not an error: no retry, because a retry cannot help.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('says an empty trail is empty', async () => {
    const read = vi.fn(async () => ({ ok: true, events: [], hasMore: false }));
    renderPanel(read);

    expect(await screen.findByText(/No agent edits yet/)).toBeTruthy();
  });

  it('states a failed read as a failure, and retries it from the button', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, events: [], notice: 'activityUnavailable' })
      .mockResolvedValueOnce({ ok: true, events: [event()], hasMore: false });
    renderPanel(read);

    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.getByText('Edited “Morning pages”')).toBeTruthy());
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('reads once per open, and drops an answer that arrives after it closed', async () => {
    let resolveRead;
    const read = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        })
    );
    const { rerender } = renderPanel(read);
    expect(read).toHaveBeenCalledTimes(1);

    rerender(<AgentActivity isOpen={false} onClose={() => {}} read={read} />);
    resolveRead({ ok: true, events: [event()], hasMore: false });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
