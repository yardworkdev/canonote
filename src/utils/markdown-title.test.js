import { describe, expect, it } from 'vitest';
import { previewFromMarkdown, titleFromMarkdown } from './markdown';

// The sidebar shows a note's first line. In a markdown-source notebook that
// line still contains its syntax, so the title must strip it.
describe('titleFromMarkdown', () => {
  it('strips heading markers', () => {
    expect(titleFromMarkdown('# Reliability check\n\nbody')).toBe('Reliability check');
    expect(titleFromMarkdown('### Deep heading')).toBe('Deep heading');
  });

  it('skips blank lines and horizontal rules', () => {
    expect(titleFromMarkdown('\n\n---\n\nReal title')).toBe('Real title');
  });

  it('strips list, task and quote markers', () => {
    expect(titleFromMarkdown('- bullet item')).toBe('bullet item');
    expect(titleFromMarkdown('1. numbered item')).toBe('numbered item');
    expect(titleFromMarkdown('- [x] done thing')).toBe('done thing');
    expect(titleFromMarkdown('> quoted thought')).toBe('quoted thought');
  });

  it('strips inline emphasis, code and link syntax', () => {
    expect(titleFromMarkdown('**Bold** and *italic*')).toBe('Bold and italic');
    expect(titleFromMarkdown('`code` first')).toBe('code first');
    expect(titleFromMarkdown('[Docs](https://example.com) page')).toBe('Docs page');
    expect(titleFromMarkdown('~~gone~~ kept')).toBe('gone kept');
  });

  it('returns an empty title when there is nothing to show', () => {
    expect(titleFromMarkdown('')).toBe('');
    expect(titleFromMarkdown('\n\n')).toBe('');
  });

  it('truncates long titles', () => {
    expect(titleFromMarkdown('x'.repeat(120))).toHaveLength(50);
  });
});

// The row's second line: the note's own next line of words, syntax removed.
describe('previewFromMarkdown', () => {
  it('takes the line after the title, not the title line', () => {
    expect(previewFromMarkdown('# Reliability check\n\nbody text')).toBe('body text');
  });

  it('skips blank lines and rules to find the next line of words', () => {
    expect(previewFromMarkdown('Title\n\n---\n\nReal second line')).toBe('Real second line');
  });

  it('strips the syntax of the line it shows', () => {
    expect(previewFromMarkdown('Title\n- [ ] **Ship** the `thing`')).toBe('Ship the thing');
  });

  it('has nothing to add for a one-line note', () => {
    expect(previewFromMarkdown('Just a title')).toBe('');
    expect(previewFromMarkdown('')).toBe('');
  });

  it('truncates a long preview', () => {
    expect(previewFromMarkdown(`Title\n${'y'.repeat(200)}`)).toHaveLength(90);
  });
});
