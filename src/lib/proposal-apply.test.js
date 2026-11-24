import { describe, expect, it } from 'vitest';
import { applyProposal, anchorOf } from './proposal-apply';

// Applying an agent's proposal is the one place a person takes someone else's
// text into their own note, so these tests are about refusing well: the wrong
// place is worse than no place.

const NOTE = `How you doing bud? write down something here let's see how it works

Promi, the agent — this line is mine, the first line is yours.

Promi again, written straight into the server with the agent token.`;

describe('the paragraph a proposal is written after', () => {
  it('is the last paragraph that is prose, not a heading or a blank', () => {
    expect(anchorOf(`${NOTE}\n\n## Next steps\n\n`)).toContain('Promi again');
  });

  it('is nothing at all in a note with no prose yet', () => {
    expect(anchorOf('')).toBeNull();
    expect(anchorOf('## Only a heading')).toBeNull();
  });
});

describe('applying a proposal', () => {
  it('appends it as its own paragraph when the note has not changed', () => {
    const result = applyProposal({
      content: NOTE,
      revision: 204,
      proposal: 'A paragraph the agent proposed.',
      baseRevision: 204,
    });
    expect(result.status).toBe('applied');
    expect(result.content.startsWith(NOTE)).toBe(true);
    expect(result.content.endsWith('A paragraph the agent proposed.\n')).toBe(true);
    // It is a paragraph, not a continuation of the last line.
    expect(result.content).toContain('token.\n\nA paragraph the agent proposed.');
  });

  it('lands after the passage it was written for when the note moved on', () => {
    const newer = `${NOTE}\n\nA paragraph the person typed while the agent was thinking.`;
    const result = applyProposal({
      content: newer,
      revision: 205,
      proposal: 'The agent wants this in the note.',
      baseRevision: 204,
      versions: [{ revision: 204, content: NOTE }],
    });
    expect(result.status).toBe('applied');
    expect(result.content).toContain('The agent wants this in the note.');
    // The person's newer paragraph is still there and still last.
    expect(result.content).toContain('A paragraph the person typed while the agent was thinking.');
    expect(result.content.indexOf('The agent wants this in the note.')).toBeGreaterThan(
      result.content.indexOf('Promi again')
    );
  });

  it('refuses when the passage it was written after has been rewritten', () => {
    const rewritten = 'Completely different note.\n\nNothing of the old text survives.';
    const result = applyProposal({
      content: rewritten,
      revision: 210,
      proposal: 'The agent wants this in the note.',
      baseRevision: 204,
      versions: [{ revision: 204, content: NOTE }],
    });
    expect(result.status).toBe('stale');
    expect(result.reason).toContain('gone');
  });

  it('refuses when it cannot see the version the proposal was written against', () => {
    const result = applyProposal({
      content: NOTE,
      revision: 210,
      proposal: 'text',
      baseRevision: 204,
      versions: [],
    });
    expect(result.status).toBe('stale');
  });

  it('refuses an empty proposal instead of touching the note', () => {
    expect(applyProposal({ content: NOTE, revision: 1, proposal: '   ', baseRevision: 1 }).status).toBe(
      'stale'
    );
  });
});
