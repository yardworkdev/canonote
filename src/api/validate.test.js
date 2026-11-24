import { describe, expect, it } from 'vitest';
import {
  agentCreateNote,
  agentUpdateNote,
  check,
  noteUpdate,
} from '../../api/_lib/validate.js';

describe('request validation', () => {
  it('accepts a well-formed agent write', () => {
    const out = check(agentCreateNote, { title: 'Pricing', content: '# Pricing\n' });
    expect(out.ok).toBe(true);
    expect(out.value.title).toBe('Pricing');
  });

  it('rejects markdown that is not a string, naming the field', () => {
    const out = check(agentCreateNote, { content: { text: 'oops' } });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(400);
    expect(out.field).toBe('content');
  });

  it('rejects a body far over the size cap instead of writing a 40 MB note', () => {
    const out = check(agentCreateNote, { content: 'x'.repeat(2 * 1024 * 1024 + 1) });
    expect(out.ok).toBe(false);
    expect(out.field).toBe('content');
  });

  it('rejects a title past the cap', () => {
    expect(check(agentCreateNote, { title: 'a'.repeat(301) }).ok).toBe(false);
  });

  it('rejects a string where the per-note switch must be a boolean', () => {
    const out = check(noteUpdate, { agentAccess: 'false' });
    expect(out.ok).toBe(false);
    expect(out.field).toBe('agentAccess');
  });

  it('accepts the per-note switch as a real boolean', () => {
    expect(check(noteUpdate, { agentAccess: false }).ok).toBe(true);
  });

  it('accepts a missing or null revision, rejects a non-string one', () => {
    expect(check(agentUpdateNote, {}).ok).toBe(true);
    expect(check(agentUpdateNote, { ifRevision: null }).ok).toBe(true);
    expect(check(agentUpdateNote, { ifRevision: 123 }).ok).toBe(false);
  });

  it('drops unknown keys rather than passing them to the database', () => {
    const out = check(agentUpdateNote, { content: 'a', user_id: 'someone-else' });
    expect(out.ok).toBe(true);
    expect(out.value).not.toHaveProperty('user_id');
  });

  it('treats an empty body as empty, not as a crash', () => {
    expect(check(agentUpdateNote, undefined).ok).toBe(true);
    expect(check(agentUpdateNote, null).ok).toBe(true);
  });
});
