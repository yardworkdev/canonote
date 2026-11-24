import { describe, it, expect, beforeEach } from 'vitest';
import {
  AGENT_NAME_KEY,
  MAX_AGENT_NAME_LENGTH,
  normalizeAgentName,
  readAgentName,
  writeAgentName,
} from './agent-settings';
import { DEFAULT_AGENT_NAME } from '../constants/agent';

describe('agent name setting', () => {
  let store;

  beforeEach(() => {
    // The test setup mocks window.localStorage with vi.fn()s; give it a real
    // in-memory implementation the way browser-storage.test.js does, so the
    // round-trip through the helpers is exercised rather than the mock.
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

  it('falls back to the neutral default when nothing is stored', () => {
    expect(readAgentName()).toBe(DEFAULT_AGENT_NAME);
  });

  it('stores the name the user picks and reads it back', () => {
    expect(writeAgentName('Claude Code')).toBe('Claude Code');
    expect(window.localStorage.getItem(AGENT_NAME_KEY)).toBe('Claude Code');
    expect(readAgentName()).toBe('Claude Code');
  });

  it('trims, collapses whitespace and caps the length', () => {
    expect(normalizeAgentName('  my   agent \n')).toBe('my agent');
    const long = 'x'.repeat(MAX_AGENT_NAME_LENGTH + 20);
    expect(normalizeAgentName(long)).toHaveLength(MAX_AGENT_NAME_LENGTH);
  });

  it('clears the setting when the name is emptied, and falls back', () => {
    writeAgentName('Something');
    expect(writeAgentName('   ')).toBe(DEFAULT_AGENT_NAME);
    expect(window.localStorage.getItem(AGENT_NAME_KEY)).toBeNull();
    expect(readAgentName()).toBe(DEFAULT_AGENT_NAME);
  });

  it('never keeps a person-specific name as the default', () => {
    expect(DEFAULT_AGENT_NAME).toBe('Agent');
    expect(readAgentName().toLowerCase()).not.toContain('rudi');
  });
});
