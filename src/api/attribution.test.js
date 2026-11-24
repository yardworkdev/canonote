import { describe, expect, it } from 'vitest';
import {
  addedSpan,
  agentSpanBytes,
  changedRegion,
  isAgentActor,
  remapSpans,
  spansAfterWrite,
} from '../../api/_lib/attribution.js';

describe('attribution', () => {
  it('marks what an agent appended and nothing else', () => {
    const before = '# Plans\n\nMonday: the notebook.';
    const after = `${before}\n\nThe agent added this paragraph.`;
    expect(spansAfterWrite({ before, after, spans: [], actorId: 'agent' })).toEqual([
      { start: before.length, end: after.length },
    ]);
  });

  it('gives a person\u2019s own words no span', () => {
    const before = 'One line.';
    expect(spansAfterWrite({ before, after: `${before} Mine too.`, spans: [], actorId: 'u-1' })).toEqual(
      []
    );
  });

  it('keeps the agent\u2019s span in place when the person edits above it', () => {
    const before = 'Header\n\nAgent paragraph.\n';
    const spans = [{ start: 8, end: 24 }];
    const after = `My new opening\n\n${before}`;
    expect(remapSpans(spans, before, after)).toEqual([
      { start: 8 + 'My new opening\n\n'.length, end: 24 + 'My new opening\n\n'.length },
    ]);
  });

  it('drops the part of a span the person replaced', () => {
    const before = 'aaaaaaaaaaAGENTTEXTbbbbbbbbbb';
    const spans = [{ start: 10, end: 19 }];
    const after = 'aaaaaaaaaaREPLACEDbbbbbbbbbb';
    expect(remapSpans(spans, before, after)).toEqual([]);
  });

  it('joins the two sides when the person edits inside the agent\u2019s text', () => {
    const before = 'aaa the agent wrote this zzz';
    const spans = [{ start: 4, end: 23 }];
    const after = 'aaa the agent WROTE this zzz';
    const [span] = remapSpans(spans, before, after);
    // 4..23 covers "the agent wrote this" — 19 characters, unchanged in length.
    expect(span).toEqual({ start: 4, end: 23 });
  });

  it('leaves a gap where the person types inside the agent\u2019s text', () => {
    const before = 'aaa AGENTTEXT zzz';
    const spans = [{ start: 4, end: 13 }];
    const after = 'aaa AGEN-mine-TTEXT zzz';
    const result = remapSpans(spans, before, after);
    // Two ranges, and the inserted characters sit between them, unpainted.
    expect(result.length).toBe(2);
    const painted = result.map((span) => after.slice(span.start, span.end)).join('|');
    expect(painted).toBe('AGEN|TTEXT');
  });

  it('lets an agent\u2019s own insertion join the block', () => {
    const before = 'aaa AGENTTEXT zzz';
    const spans = [{ start: 4, end: 13 }];
    const after = 'aaa AGENT-more-TEXT zzz';
    const [span] = remapSpans(spans, before, after, { insertGrows: true });
    expect(after.slice(span.start, span.end)).toBe('AGENT-more-TEXT');
  });

  it('treats a pure deletion as bringing nothing in', () => {
    expect(addedSpan('keep this and remove this', 'keep this')).toBeNull();
  });

  it('measures the changed region once, from both ends', () => {
    expect(changedRegion('abcXYZdef', 'abcQQdef')).toEqual({
      beforeStart: 3,
      beforeEnd: 6,
      afterStart: 3,
      afterEnd: 5,
    });
  });

  it('recognises the actor ids agents actually write with', () => {
    expect(isAgentActor('agent')).toBe(true);
    expect(isAgentActor('agent_rudi')).toBe(true);
    expect(isAgentActor('agent_promi')).toBe(true);
    expect(isAgentActor('fa843a5d-bf35-4c23-a4b6-acd9fdf2b116')).toBe(false);
    expect(isAgentActor(null)).toBe(false);
  });

  it('adds up how much of the note is the agent\u2019s', () => {
    expect(agentSpanBytes([{ start: 0, end: 5 }, { start: 10, end: 12 }])).toBe(7);
    expect(agentSpanBytes(null)).toBe(0);
  });
});
