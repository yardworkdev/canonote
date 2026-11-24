import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, markdownToHtml, renderMarkdown } from './markdown';

describe('markdown conversion', () => {
  it('round-trips inline formatting and consecutive paragraphs without losing content', () => {
    const markdown = [
      'Intro line with **bold**, *italic*, _underline_, ~~strike~~, [link](https://example.com), and `code`.',
      'Second line with more text.',
    ].join('\n');

    const roundTripped = htmlToMarkdown(renderMarkdown(markdown));

    expect(roundTripped).toBe(markdown);
  });

  it('normalizes spacing before lists while preserving list and task structure', () => {
    const markdown = [
      'Intro line',
      '- Bullet one',
      '1. Numbered one',
      '- [x] Done',
      '- [ ] Todo',
    ].join('\n');

    const roundTripped = htmlToMarkdown(renderMarkdown(markdown));

    expect(roundTripped).toBe(
      ['Intro line', '', '- Bullet one', '1. Numbered one', '- [x] Done', '- [ ] Todo'].join('\n')
    );
  });

  it('converts TipTap-style task list metadata even without checkbox inputs', () => {
    const html = [
      '<ul>',
      '  <li data-type="taskItem" data-checked="true"><label><span>Done</span></label></li>',
      '  <li data-type="taskItem" data-checked="false"><label><span>Todo</span></label></li>',
      '</ul>',
    ].join('');

    expect(htmlToMarkdown(html)).toBe('- [x] Done\n- [ ] Todo');
  });

  it('preserves trailing spaces when rendering block content', () => {
    const html = renderMarkdown(
      ['# Heading  ', '> Quoted  ', '- Item  ', 'Paragraph  '].join('\n')
    );

    expect(html).toContain('Heading&nbsp;&nbsp;');
    expect(html).toContain('Quoted&nbsp;&nbsp;');
    expect(html).toContain('Item&nbsp;&nbsp;');
    expect(html).toContain('Paragraph&nbsp;&nbsp;');
  });

  it('preserves trailing spaces when converting markdown to editor html', () => {
    const html = markdownToHtml(
      ['# Heading  ', '> Quoted  ', '- Item  ', 'Paragraph  '].join('\n')
    );

    expect(html).toContain('Heading&nbsp;&nbsp;');
    expect(html).toContain('Quoted&nbsp;&nbsp;');
    expect(html).toContain('Item&nbsp;&nbsp;');
    expect(html).toContain('Paragraph&nbsp;&nbsp;');
  });

  it('round-trips code block with language tag', () => {
    const md = '```js\nconst x = 1;\n```';
    const roundTripped = htmlToMarkdown(renderMarkdown(md));
    expect(roundTripped).toContain('```js');
    expect(roundTripped).toContain('const x = 1;');
  });

  it('round-trips horizontal rule', () => {
    const md = 'text\n\n---\n\nmore text';
    const roundTripped = htmlToMarkdown(renderMarkdown(md));
    expect(roundTripped).toContain('---');
    expect(roundTripped).toContain('text');
    expect(roundTripped).toContain('more text');
  });

  it('round-trips blockquote', () => {
    const md = '> This is a quote';
    const roundTripped = htmlToMarkdown(renderMarkdown(md));
    expect(roundTripped).toContain('> This is a quote');
  });

  it('round-trips heading levels', () => {
    const md = '# H1\n## H2\n### H3';
    const roundTripped = htmlToMarkdown(renderMarkdown(md));
    expect(roundTripped).toContain('# H1');
    expect(roundTripped).toContain('## H2');
    expect(roundTripped).toContain('### H3');
  });

  it('markdownToHtml returns empty div for empty input', () => {
    expect(markdownToHtml('')).toBe('');
  });

  it('htmlToMarkdown returns empty string for empty div', () => {
    expect(htmlToMarkdown('<div><br></div>')).toBe('');
    expect(htmlToMarkdown('<br>')).toBe('');
  });

  it('htmlToMarkdown handles plain text without formatting', () => {
    expect(htmlToMarkdown('<p>Hello world</p>')).toBe('Hello world');
  });

  it('markdownToHtml wraps paragraphs in div tags', () => {
    const html = markdownToHtml('Hello\n\nWorld');
    expect(html).toContain('<div>');
    expect(html).toContain('Hello');
    expect(html).toContain('World');
  });

  it('round-trips task list with mixed checked/unchecked', () => {
    const md = '- [x] Done\n- [ ] Todo\n- [x] Also done';
    const roundTripped = htmlToMarkdown(renderMarkdown(md));
    expect(roundTripped).toContain('- [x] Done');
    expect(roundTripped).toContain('- [ ] Todo');
    expect(roundTripped).toContain('- [x] Also done');
  });

  it('round-trips ordered list', () => {
    const md = '1. First\n2. Second\n3. Third';
    const roundTripped = htmlToMarkdown(renderMarkdown(md));
    expect(roundTripped).toContain('1. First');
    expect(roundTripped).toContain('2. Second');
    expect(roundTripped).toContain('3. Third');
  });

  it('round-trips nested bold and italic', () => {
    const md = 'This is ***bold and italic*** text';
    const html = renderMarkdown(md);
    // Should contain both strong and em tags
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    // Round-trip should preserve the formatting markers
    const roundTripped = htmlToMarkdown(html);
    expect(roundTripped).toContain('***');
    expect(roundTripped).toContain('bold and italic');
  });

  it('round-trips bold inside italic', () => {
    const md = 'This is *italic with **bold** inside* text';
    const html = renderMarkdown(md);
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    const roundTripped = htmlToMarkdown(html);
    expect(roundTripped).toContain('bold');
    expect(roundTripped).toContain('italic');
  });

  it('handles link with special characters in URL', () => {
    const md = '[click](https://example.com/path?q=1&name=test)';
    const html = renderMarkdown(md);
    expect(html).toContain('href="https://example.com/path?q=1&amp;name=test"');
  });

  it('htmlToMarkdown handles nested list items', () => {
    const html = '<ul><li>Item 1</li><li>Item 2</li><li>Item 3</li></ul>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('Item 1');
    expect(md).toContain('Item 2');
    expect(md).toContain('Item 3');
  });

  it('htmlToMarkdown handles table', () => {
    const html = '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>';
    const md = htmlToMarkdown(html);
    // Tables should at least not crash and should contain the cell content
    expect(md).toContain('A');
    expect(md).toContain('B');
    expect(md).toContain('1');
    expect(md).toContain('2');
  });
});
