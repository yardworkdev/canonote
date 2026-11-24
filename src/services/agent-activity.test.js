import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIVITY_LIMIT, activitySentence, actorLabel, readAgentActivity } from './agent-activity';

/**
 * The client half of the audit read: which of the three answers the panel gets
 * — the trail, "nothing to read from", or "the read failed" — and the fact that
 * the shipped local mode does not call the server at all.
 */

const jsonResponse = (body, { status = 200, ok = status < 400 } = {}) => ({
  status,
  ok,
  json: async () => body,
});

const withHeaders = (impl, headers = { Authorization: 'Bearer session-token' }) =>
  readAgentActivity({ headers, fetchImpl: impl });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('reading the agent trail', () => {
  it('asks the documented route for the trail and sends the session', async () => {
    const calls = [];
    const impl = async (url, options) => {
      calls.push([url, options]);
      return jsonResponse({ success: true, data: [], pageInfo: { hasMore: false } });
    };

    const result = await withHeaders(impl);

    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(`/api/agent/audit?limit=${ACTIVITY_LIMIT}`);
    expect(calls[0][1].headers.Authorization).toBe('Bearer session-token');
    expect(result).toEqual({ ok: true, events: [], hasMore: false, notice: null });
  });

  it('carries the events and whether the server has more', async () => {
    const events = [{ eventId: 'e1', action: 'notes.create' }];
    const impl = async () => jsonResponse({ data: events, pageInfo: { hasMore: true } });

    expect(await withHeaders(impl)).toEqual({
      ok: true,
      events,
      hasMore: true,
      notice: null,
    });
  });

  it('answers an empty trail rather than an error for a body with no data', async () => {
    const impl = async () => jsonResponse({ success: true });

    expect(await withHeaders(impl)).toMatchObject({ ok: true, events: [], hasMore: false });
  });

  it('reads a body it cannot parse as an empty trail, not as a failure', async () => {
    const impl = async () => ({
      status: 200,
      ok: true,
      json: async () => {
        throw new Error('not json');
      },
    });

    expect(await withHeaders(impl)).toMatchObject({ ok: true, events: [] });
  });

  it('names an ended session as an ended session, not as a broken server', async () => {
    for (const status of [401, 403]) {
      const result = await withHeaders(async () => jsonResponse({}, { status }));
      expect(result.ok).toBe(false);
      expect(result.notice).toBe('activitySignedOut');
    }
  });

  it('names a server that did not answer as a failed read, with a step', async () => {
    const failed = await withHeaders(async () => jsonResponse({}, { status: 500 }));
    expect(failed.notice).toBe('activityUnavailable');

    const refused = await withHeaders(async () => jsonResponse({}, { status: 503 }));
    expect(refused.notice).toBe('activityUnavailable');

    const threw = await withHeaders(async () => {
      throw new Error('network down');
    });
    expect(threw.notice).toBe('activityUnavailable');
    expect(threw.events).toEqual([]);
  });

  it('does not call the server when the notebook has no session', async () => {
    const impl = vi.fn(async () => jsonResponse({ data: [] }));

    const result = await withHeaders(impl, {});

    expect(impl).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, notice: 'activityNoSession', events: [] });
  });

  it('reads the session itself when no headers are handed in, and stays local without one', async () => {
    const impl = vi.fn(async () => jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', impl);

    // jsdom has no Supabase credentials, so this is the shipped local mode:
    // no session, no request, and the honest sentence for it.
    const result = await readAgentActivity();

    expect(impl).not.toHaveBeenCalled();
    expect(result.notice).toBe('activityNoSession');
  });

  it('answers a failure rather than throwing when the environment has no fetch', async () => {
    vi.stubGlobal('fetch', undefined);
    const result = await readAgentActivity({ headers: { Authorization: 'Bearer x' } });
    expect(result.notice).toBe('activityUnavailable');
  });
});

describe('the sentence an event becomes', () => {
  it('names the verb the trail records', () => {
    expect(activitySentence({ action: 'notes.create' }, 'Draft')).toBe('Created “Draft”');
    expect(activitySentence({ action: 'notes.update' }, 'Draft')).toBe('Edited “Draft”');
    expect(activitySentence({ action: 'notes.update' })).toBe('Edited a note');
  });

  it('shows an action it does not know as it was recorded, never guessed at', () => {
    expect(activitySentence({ action: 'notes.restore' }, 'Draft')).toBe(
      'notes.restore — “Draft”'
    );
    expect(activitySentence({ action: 'notes.restore' })).toBe('notes.restore');
    expect(activitySentence({})).toBe('Changed a note');
    expect(activitySentence({}, 'Draft')).toBe('Changed “Draft”');
  });

  it('names the actor', () => {
    expect(actorLabel({ actorType: 'user' })).toBe('you');
    expect(actorLabel({ actorType: 'agent', actorId: 'claude-code' })).toBe('claude-code');
    expect(actorLabel({})).toBe('an agent');
  });
});
