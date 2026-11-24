import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import AgentTab from './AgentTab';

// The panel's promise is "one decision, one button": name the agent, click, get a
// token. These hold the press to that, and hold the unchecked state to saying it
// cannot work rather than failing when pressed.

vi.mock('../services/agent-connections', () => ({
  issueAgentToken: vi.fn(),
  listAgentConnections: vi.fn(),
  revokeAgentConnection: vi.fn(),
}));

import { issueAgentToken, listAgentConnections } from '../services/agent-connections';

describe('AgentTab', () => {
  beforeEach(() => {
    localStorage.clear();
    issueAgentToken.mockReset();
    listAgentConnections.mockReset();
    listAgentConnections.mockResolvedValue([]);
  });

  it('creates a token with one press and shows it once', async () => {
    issueAgentToken.mockResolvedValue({ token: 'cn_live_abcdefghijklmnop', id: 'c1' });

    render(<AgentTab />);
    await waitFor(() => expect(listAgentConnections).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /create token/i }));

    expect(await screen.findByText('cn_live_abcdefghijklmnop')).toBeInTheDocument();
    expect(issueAgentToken).toHaveBeenCalledTimes(1);
    expect(issueAgentToken).toHaveBeenCalledWith({ agentLabel: 'Agent' });
    expect(screen.getByRole('button', { name: /copy for your agent/i })).toBeInTheDocument();
    expect(screen.getByText(/shown once/i)).toBeInTheDocument();
  });

  it('uses the name the person typed', async () => {
    issueAgentToken.mockResolvedValue({ token: 'cn_live_zzzzzzzzzzzzzzzz', id: 'c2' });

    render(<AgentTab />);
    const name = screen.getByLabelText('Agent name');
    fireEvent.change(name, { target: { value: 'Promi' } });
    fireEvent.click(screen.getByRole('button', { name: /create token/i }));

    await waitFor(() =>
      expect(issueAgentToken).toHaveBeenCalledWith({ agentLabel: 'Promi' })
    );
  });

  it('says when a token was last used, and says never when it was not', async () => {
    listAgentConnections.mockResolvedValue([
      {
        id: 'c1',
        agentLabel: 'Promi',
        expiresAt: '2026-12-10T00:00:00.000Z',
        lastUsedAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
      },
      { id: 'c2', agentLabel: 'Quiet', expiresAt: null, lastUsedAt: null },
    ]);

    render(<AgentTab />);

    // The point of the row: an owner can tell a token that is in use from one
    // that has never been used, without asking the server for anything else.
    expect(await screen.findByText(/used 3 min ago/i)).toBeInTheDocument();
    expect(screen.getByText(/never used/i)).toBeInTheDocument();
    expect(screen.getByText(/until 2026-12-10/)).toBeInTheDocument();
  });

  it('says agents need an account instead of offering a button that cannot work', () => {
    render(<AgentTab agentsEnabled={false} />);

    expect(screen.getByText(/agents need an account/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create token/i })).not.toBeInTheDocument();
  });
});
