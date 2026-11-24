import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PresenceBar from '../components/PresenceBar';

describe('PresenceBar', () => {
  it('says nothing when nobody else is here', () => {
    const { container } = render(<PresenceBar others={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names a person who has the note open', () => {
    render(<PresenceBar others={[{ kind: 'human', id: 'u1', name: 'Ves' }]} />);
    expect(screen.getByText('Ves')).toBeInTheDocument();
  });

  it('says what an agent is doing, not just that it is here', () => {
    render(<PresenceBar others={[{ kind: 'agent', id: 'a1', name: 'Rudi', mode: 'proposing' }]} />);
    expect(screen.getByText('Rudi · proposing')).toBeInTheDocument();
    expect(screen.getByText('Rudi · proposing')).toHaveAttribute(
      'title',
      'An agent is in this note: Rudi · proposing'
    );
  });

  it('shows an agent and a person side by side, people first', () => {
    render(
      <PresenceBar
        others={[
          { kind: 'human', id: 'u1', name: 'Ves' },
          { kind: 'agent', id: 'a1', name: 'Rudi', mode: 'writing' },
        ]}
      />
    );
    const bar = document.querySelector('[data-presence-bar]');
    expect(bar.textContent).toBe('VesRudi · writing');
  });

  it('marks an away agent instead of pretending it is working', () => {
    render(<PresenceBar others={[{ kind: 'agent', id: 'a1', name: 'Rudi', mode: 'reading', away: true }]} />);
    expect(screen.getByText('Rudi · away')).toBeInTheDocument();
  });
});
