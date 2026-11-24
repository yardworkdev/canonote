import React, { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import MarkdownEditor from './MarkdownEditor';

const renderEditor = (props = {}) => {
  const ref = createRef();
  const onChange = vi.fn();
  const value = props.value ?? '';
  const utils = render(<MarkdownEditor ref={ref} value={value} onChange={onChange} {...props} />);
  const textarea = utils.container.querySelector('textarea');
  return { ref, onChange, textarea, ...utils };
};

describe('MarkdownEditor selection helpers', () => {
  it('is a controlled textarea that renders the markdown value', () => {
    const { textarea } = renderEditor({ value: '# Hello' });
    expect(textarea.value).toBe('# Hello');
    expect(textarea.getAttribute('aria-label')).toBe('Note editor');
  });

  it('insertAtCursor inserts at the caret and reports the new value', () => {
    const { ref, onChange, textarea } = renderEditor({ value: 'hello world' });
    textarea.setSelectionRange(5, 5);

    act(() => ref.current.insertAtCursor(','));

    expect(onChange).toHaveBeenCalledWith('hello, world');
    expect(textarea.value).toBe('hello, world');
    expect(textarea.selectionStart).toBe(6);
  });

  it('replaceSelection swaps the selected range', () => {
    const { ref, onChange, textarea } = renderEditor({ value: 'hello world' });
    textarea.setSelectionRange(6, 11);

    act(() => ref.current.replaceSelection('there'));

    expect(onChange).toHaveBeenCalledWith('hello there');
    expect(textarea.selectionStart).toBe(11);
  });

  it('reads and writes the current selection', () => {
    const { ref, textarea } = renderEditor({ value: 'abcdef' });

    act(() => ref.current.setSelection(2, 4));

    expect(ref.current.getSelection()).toEqual({ start: 2, end: 4, text: 'cd' });
    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(4);
  });

  it('setValue pushes the new value through onChange', () => {
    const { ref, onChange } = renderEditor({ value: 'old' });

    act(() => ref.current.setValue('new'));

    expect(onChange).toHaveBeenCalledWith('new');
    expect(ref.current.getValue()).toBe('new');
  });
});

describe('MarkdownEditor agent band', () => {
  const renderWithBand = () =>
    renderEditor({ value: 'mine\nthe agent wrote this', spans: [{ start: 5, end: 25 }] });

  it('paints a band behind the agent range', () => {
    const { container } = renderWithBand();
    const backdrop = container.querySelector('[data-agent-highlights]');
    expect(backdrop).not.toBeNull();
    expect(backdrop.querySelector('[data-agent-span]').textContent).toBe('the agent wrote this');
  });

  // The band is drawn in a second box; if that box keeps its own scroll position
  // the mark sits over different words than the ones it claims. On a long note it
  // was measured 192px off, which put the whole band below the fold. It follows by
  // transform now: two scroll containers clamp at different heights and each event
  // lands a frame late, which is what made the band bounce.
  // Collaboration is visible or it is not collaboration. Another writer's caret is
  // drawn in the same mirror as the band, so it lands on the character it names.
  it('draws another writer’s caret where their cursor is', () => {
    const { container } = renderEditor({
      value: 'mine\nthe agent wrote this',
      remoteRanges: [{ id: 'a1', name: 'Promi', from: 8, to: 8 }],
    });
    const caret = container.querySelector('[data-remote-author="Promi"]');
    expect(caret).not.toBeNull();
    expect(caret.className).toBe('remote-caret');
  });

  it('tints the range another writer has selected', () => {
    const { container } = renderEditor({
      value: 'mine\nthe agent wrote this',
      remoteRanges: [{ id: 'a1', name: 'Promi', from: 5, to: 14 }],
    });
    const selection = container.querySelector('[data-remote-selection="Promi"]');
    expect(selection).not.toBeNull();
    expect(selection.textContent).toBe('the agent');
  });

  // A remote write arrives as new text and new ranges in the same render. Remapping
  // the old ranges onto the new text lost the band entirely (0 marked runs on
  // production), so the ranges win when they are new.
  it('takes new ranges that arrive together with new text', () => {
    const { container, rerender } = renderEditor({
      value: 'mine\n',
      spans: [{ start: 0, end: 4 }],
    });
    rerender(
      <MarkdownEditor
        value={'mine\nthe agent wrote this\n'}
        onChange={() => {}}
        spans={[{ start: 5, end: 25 }]}
      />
    );
    const marked = container.querySelector('[data-agent-span]');
    expect(marked.textContent).toBe('the agent wrote this');
  });

  it('keeps the band on the textarea scroll line', () => {
    const { container, textarea, rerender } = renderWithBand();
    const backdrop = container.querySelector('[data-agent-highlights]');

    textarea.scrollTop = 120;
    textarea.scrollLeft = 7;
    rerender(<MarkdownEditor value={textarea.value} onChange={() => {}} spans={[{ start: 5, end: 25 }]} />);

    expect(backdrop.style.transform).toBe('translate3d(-7px, -120px, 0)');
    expect(backdrop.scrollTop).toBe(0);
  });
});
