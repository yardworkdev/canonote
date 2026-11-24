import { describe, expect, it } from 'vitest';
import { filterAgentVisible, hidesFromAgent, isVisibleToAgent } from '../../api/_lib/agent-access.js';

const note = (id, agent_access) => ({ note_id: id, agent_access });

describe('per-note agent access', () => {
  it('treats a note with no flag as visible, so nothing existing changes', () => {
    expect(isVisibleToAgent({ note_id: 'a' })).toBe(true);
    expect(isVisibleToAgent(null)).toBe(false);
  });

  it('hides a note whose switch is off', () => {
    expect(isVisibleToAgent(note('a', false))).toBe(false);
    expect(hidesFromAgent(note('a', false))).toBe(true);
  });

  it('reads the same switch from the database row and the reference store', () => {
    // agent_access in Postgres, agentAccess in the in-memory server: one accessor
    expect(isVisibleToAgent({ note_id: 'a', agentAccess: false })).toBe(false);
    expect(isVisibleToAgent({ note_id: 'a', agent_access: false })).toBe(false);
    expect(isVisibleToAgent({ note_id: 'a', agentAccess: true })).toBe(true);
  });

  it('keeps order and drops only the switched-off notes', () => {
    const rows = [note('a', true), note('b', false), { note_id: 'c' }, note('d', false)];
    expect(filterAgentVisible(rows).map((r) => r.note_id)).toEqual(['a', 'c']);
  });

  it('returns an empty list rather than throwing on bad input', () => {
    expect(filterAgentVisible(null)).toEqual([]);
    expect(filterAgentVisible(undefined)).toEqual([]);
    expect(filterAgentVisible('nope')).toEqual([]);
  });

  it('treats an off note exactly like a missing one on the single-note path', () => {
    // both produce null, so the handler answers 404 for each and the agent cannot
    // tell the difference between "switched off" and "does not exist"
    const missing = null;
    const off = note('secret', false);
    expect(missing && !hidesFromAgent(missing) ? missing : null).toBe(null);
    expect(off && !hidesFromAgent(off) ? off : null).toBe(null);
  });
});
