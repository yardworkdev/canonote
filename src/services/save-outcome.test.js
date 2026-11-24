import { describe, expect, it } from 'vitest';
import { describeSaveOutcome } from './save-outcome.js';

describe('what a save attempt means', () => {
  it('treats a 200 or 201 as saved and clears the draft', () => {
    for (const status of [200, 201]) {
      const outcome = describeSaveOutcome({ status });
      expect(outcome.kind).toBe('saved');
      expect(outcome.keepDraft).toBe(false);
    }
  });

  it('treats a stale revision as a conflict that can be rebased, not an error', () => {
    const outcome = describeSaveOutcome({ status: 409 });
    expect(outcome.kind).toBe('conflict');
    expect(outcome.rebase).toBe(true);
    expect(outcome.keepDraft).toBe(true);
    expect(outcome.message).toMatch(/saved locally/i);
  });

  it('treats a missing revision as a precondition, not a conflict', () => {
    expect(describeSaveOutcome({ status: 428 }).kind).toBe('precondition');
  });

  it('refuses to resurrect a deleted note and keeps the draft', () => {
    const outcome = describeSaveOutcome({ status: 404 });
    expect(outcome.kind).toBe('missing');
    expect(outcome.retryable).toBe(false);
    expect(outcome.keepDraft).toBe(true);
    expect(outcome.message).toMatch(/deleted/i);
  });

  it('says a draft is kept when the network is gone, and that it is worth retrying', () => {
    const outcome = describeSaveOutcome({ online: false });
    expect(outcome.kind).toBe('offline');
    expect(outcome.retryable).toBe(true);
    expect(outcome.keepDraft).toBe(true);
  });

  it('retries server failures but not a rejection of the request itself', () => {
    expect(describeSaveOutcome({ status: 503 }).retryable).toBe(true);
    expect(describeSaveOutcome({ status: 400 }).retryable).toBe(false);
    expect(describeSaveOutcome({ status: 403 }).message).toMatch(/not allowed/i);
  });

  it('recognises a domain conflict that arrives with a 200-shaped error body', () => {
    expect(describeSaveOutcome({ status: 500, code: 'REVISION_CONFLICT' }).kind).toBe('conflict');
  });

  it('never returns an empty message for anything the user has to see', () => {
    for (const status of [404, 409, 428, 429, 500, 0]) {
      expect(describeSaveOutcome({ status }).message.length).toBeGreaterThan(10);
    }
  });
});
