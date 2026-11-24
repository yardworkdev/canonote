import { describe, expect, it } from 'vitest';
import {
  appendToNote,
  authors,
  countWords,
  createNote,
  joinBlocks,
  replaceNote,
  revisionOf,
} from '../../scripts/lib/notebook-store.js';

const at = '2026-11-08T21:40:00.000Z';
const note = () =>
  createNote({ id: 'note-041', title: 'Deploy checks', body: '# Deploy checks\n\n- build passes', author: 'agent', at }).note;

describe('creating', () => {
  it('refuses a note with no title', () => {
    const out = createNote({ id: 'x', title: '   ', author: 'agent', at });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(400);
  });

  it('an agent note lands in the agent folder and records its author', () => {
    const out = createNote({ id: 'note-041', title: 'Deploy checks', body: 'hello', author: 'agent', at });
    expect(out.status).toBe(201);
    expect(out.note.folder).toBe('agent');
    expect(out.note.contributors).toEqual(['agent']);
    expect(out.note.rev).toBe(revisionOf('hello'));
  });
});

describe('appending is safe under concurrency', () => {
  it('keeps everything when an agent and a person both append', () => {
    // append is what makes concurrency safe: neither writer has to hold the note,
    // and applying them one after the other loses nothing.
    let n = note();
    n = appendToNote(n, '## Notes\n\nRan on the release branch.', { author: 'agent', at }).note;
    n = appendToNote(n, '- I want a canary step in here.', { author: 'human', at }).note;
    expect(n.body).toContain('build passes');
    expect(n.body).toContain('Ran on the release branch');
    expect(n.body).toContain('canary step');
  });

  it('shows what replace would have destroyed, and why it is guarded', () => {
    let n = note();
    n = appendToNote(n, '- I want a canary step in here.', { author: 'human', at }).note;
    const stale = replaceNote(n, '# Deploy checks', { ifRev: revisionOf('# Deploy checks\n\n- build passes'), author: 'agent', at });
    expect(stale.status).toBe(409);
    expect(stale.body).toContain('canary step'); // the human line is still there
  });

  it('records both authors once, in order', () => {
    let n = note();
    n = appendToNote(n, 'first', { author: 'agent', at }).note;
    n = appendToNote(n, 'second', { author: 'human', at }).note;
    n = appendToNote(n, 'third', { author: 'human', at }).note;
    expect(authors(n)).toEqual(['agent', 'human']);
    expect(n.updatedBy).toBe('human');
  });

  it('refuses an empty append instead of adding whitespace', () => {
    expect(appendToNote(note(), '   ', { author: 'agent', at }).status).toBe(400);
  });

  it('joins blocks with exactly one blank line', () => {
    expect(joinBlocks('a\n\n', '\n\nb')).toBe('a\n\nb');
    expect(joinBlocks('', 'b')).toBe('b');
    expect(joinBlocks('a', '')).toBe('a');
  });
});

describe('replacing is guarded', () => {
  it('refuses a replace with no revision', () => {
    const out = replaceNote(note(), 'new text', { author: 'agent', at });
    expect(out.status).toBe(428);
  });

  it('refuses a stale revision and hands back the current one', () => {
    const n = appendToNote(note(), 'a person was here', { author: 'human', at }).note;
    const out = replaceNote(n, 'new text', { ifRev: revisionOf('something else'), author: 'agent', at });
    expect(out.status).toBe(409);
    expect(out.rev).toBe(n.rev);
    expect(out.body).toContain('a person was here');
  });

  it('accepts a write based on the revision it actually read', () => {
    const n = note();
    const out = replaceNote(n, '# Deploy checks\n\n- canary first', { ifRev: n.rev, author: 'agent', at });
    expect(out.status).toBe(200);
    expect(out.note.rev).toBe(revisionOf('# Deploy checks\n\n- canary first'));
    expect(out.note.contributors).toEqual(['agent']);
  });

  it('keeps the earlier author in the contributor list after a replace', () => {
    let n = appendToNote(note(), 'human line', { author: 'human', at }).note;
    n = replaceNote(n, 'agent rewrote it', { ifRev: n.rev, author: 'agent', at }).note;
    expect(n.contributors).toEqual(['agent', 'human']);
  });
});

describe('sizes', () => {
  it('counts words the same way the notebook does', () => {
    expect(countWords('  one two\n\nthree ')).toBe(3);
    expect(countWords('')).toBe(0);
  });

  it('produces a revision that changes with the body and is short', () => {
    expect(revisionOf('a')).not.toBe(revisionOf('b'));
    expect(revisionOf('a')).toHaveLength(16);
  });
});
