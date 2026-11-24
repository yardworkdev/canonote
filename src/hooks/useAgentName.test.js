import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgentName } from './useAgentName';
import { AGENT_NAME_KEY } from '../services/agent-settings';
import { DEFAULT_AGENT_NAME } from '../constants/agent';

describe('useAgentName', () => {
  let store;

  beforeEach(() => {
    store = new Map();
    window.localStorage.getItem.mockImplementation((key) =>
      store.has(key) ? store.get(key) : null
    );
    window.localStorage.setItem.mockImplementation((key, value) => {
      store.set(key, value);
    });
    window.localStorage.removeItem.mockImplementation((key) => {
      store.delete(key);
    });
    store.clear();
  });

  it('starts on the neutral default and exposes the stored name', () => {
    const { result } = renderHook(() => useAgentName());
    expect(result.current.agentName).toBe(DEFAULT_AGENT_NAME);

    act(() => {
      result.current.setAgentName('Notetaker');
    });
    expect(result.current.agentName).toBe('Notetaker');
    expect(window.localStorage.getItem(AGENT_NAME_KEY)).toBe('Notetaker');
  });

  it('returns the effective name when cleared', () => {
    const { result } = renderHook(() => useAgentName());
    act(() => {
      result.current.setAgentName('Notetaker');
    });
    act(() => {
      result.current.setAgentName('');
    });
    expect(result.current.agentName).toBe(DEFAULT_AGENT_NAME);
  });

  it('keeps a second consumer in sync through the update event', () => {
    const first = renderHook(() => useAgentName());
    const second = renderHook(() => useAgentName());

    act(() => {
      first.result.current.setAgentName('Copilot');
    });

    expect(second.result.current.agentName).toBe('Copilot');
  });

  it('reads the stored name when it mounts', () => {
    window.localStorage.setItem(AGENT_NAME_KEY, 'Stored Agent');
    const { result } = renderHook(() => useAgentName());
    expect(result.current.agentName).toBe('Stored Agent');
  });
});
