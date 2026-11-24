import { describe, expect, it, vi } from 'vitest';
import {
  MAX_MESSAGE_BYTES,
  PRESENCE_TTL_MS,
  createThrottle,
  decodePresence,
  describePresence,
  encodePresence,
  isFresh,
  livePresence,
} from './presence-codec.js';

describe('presence', () => {
  it('keeps a human caret inside the byte budget', () => {
    const payload = encodePresence({ kind: 'human', id: 'u1', name: 'Ves', from: 412, to: 412, at: 1000 });
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    expect(payload).toMatchObject({ k: 'human', n: 'Ves', f: 412, t: 412 });
  });

  it('carries what an agent is doing, not just where it is', () => {
    const payload = encodePresence({ kind: 'agent', id: 'a1', name: 'Rudi', mode: 'proposing', from: 380, to: 512, at: 5 });
    expect(payload.m).toBe('proposing');
    expect(decodePresence(payload)).toMatchObject({ kind: 'agent', mode: 'proposing', from: 380, to: 512 });
  });

  it('falls back to reading rather than inventing a mode', () => {
    const payload = encodePresence({ kind: 'agent', id: 'a1', name: 'Rudi', mode: 'daydreaming' });
    expect(payload.m).toBe('reading');
  });

  it('clips a runaway name instead of spending the budget on it', () => {
    const payload = encodePresence({ kind: 'human', id: 'x'.repeat(200), name: 'y'.repeat(200) });
    expect(payload.n).toHaveLength(24);
    expect(payload.id).toHaveLength(40);
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
  });

  it('treats junk as nothing, never as a caret at zero', () => {
    expect(decodePresence('not json')).toBeNull();
    expect(decodePresence({ v: 2, k: 'human', id: 'a', at: 1 })).toBeNull();
    expect(decodePresence({ v: 1, k: 'robot', id: 'a', at: 1 })).toBeNull();
    expect(decodePresence({ v: 1, k: 'human', id: 'a' })).toBeNull();
  });

  it('drops a queued message from a closed tab', () => {
    const entry = { at: 1000 };
    expect(isFresh(entry, 1000 + PRESENCE_TTL_MS)).toBe(true);
    expect(isFresh(entry, 1001 + PRESENCE_TTL_MS)).toBe(false);
  });

  it('shows each person once, newest, and never yourself', () => {
    const now = 10_000;
    const live = livePresence(
      [
        { kind: 'human', id: 'me', name: 'Ves', at: now - 100 },
        { kind: 'agent', id: 'a1', name: 'Rudi', mode: 'reading', at: now - 200 },
        { kind: 'agent', id: 'a1', name: 'Rudi', mode: 'writing', at: now - 50 },
        { kind: 'human', id: 'gone', name: 'Ghost', at: now - PRESENCE_TTL_MS - 1 },
      ],
      { now, selfId: 'me' }
    );
    expect(live.map((e) => e.id)).toEqual(['a1']);
    expect(live[0].mode).toBe('writing');
  });

  it('describes an agent by what it is doing', () => {
    expect(describePresence({ kind: 'agent', name: 'Rudi', mode: 'proposing' })).toBe('Rudi · proposing');
    expect(describePresence({ kind: 'agent', name: 'Rudi', mode: 'reading', away: true })).toBe('Rudi · away');
    expect(describePresence({ kind: 'human', name: 'Ves' })).toBe('Ves');
    expect(describePresence(null)).toBe('');
  });

  it('sends at most ten messages a second and keeps the last position', () => {
    vi.useFakeTimers();
    try {
      let clock = 0;
      const throttle = createThrottle({ now: () => clock });
      const sent = [];
      for (let i = 0; i < 30; i += 1) throttle.push(i, (v) => sent.push(v));
      expect(sent).toHaveLength(10);
      expect(sent[9]).toBe(9);
      clock = 1000;
      vi.runOnlyPendingTimers();
      expect(sent.at(-1)).toBe(29);
      throttle.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
