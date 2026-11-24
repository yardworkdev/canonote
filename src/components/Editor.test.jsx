import React, { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import Editor from './Editor';

// Editor is the thin wrapper around the markdown source surface. These tests
// pin the contract the rest of the app depends on: content is a markdown
// string in and out, and the pane's editorRef exposes the textarea helpers.
describe('Editor (markdown source surface)', () => {
  const setup = (props = {}) => {
    const editorRef = createRef();
    const onContentChange = vi.fn();
    const onFocusPane = vi.fn();
    const utils = render(
      <Editor
        editorRef={editorRef}
        content={props.content ?? ''}
        onContentChange={onContentChange}
        onFocusPane={onFocusPane}
        {...props}
      />
    );
    const textarea = utils.container.querySelector('textarea');
    return { editorRef, onContentChange, onFocusPane, textarea, ...utils };
  };

  it('renders the note markdown as plain text', () => {
    const { textarea } = setup({ content: '# Title\n\n- one\n- two' });
    expect(textarea.value).toBe('# Title\n\n- one\n- two');
    expect(textarea.tagName).toBe('TEXTAREA');
  });

  it('reports typed markdown through onContentChange', () => {
    const { textarea, onContentChange } = setup({ content: 'abc' });
    fireEvent.change(textarea, { target: { value: 'abcd' } });
    expect(onContentChange).toHaveBeenCalledWith('abcd');
  });

  it('reports focus to the pane owner', () => {
    const { textarea, onFocusPane } = setup();
    fireEvent.focus(textarea);
    expect(onFocusPane).toHaveBeenCalled();
  });

  it('exposes selection helpers through editorRef', () => {
    const { editorRef, onContentChange, textarea } = setup({ content: 'hello world' });
    textarea.setSelectionRange(0, 5);

    act(() => editorRef.current.replaceSelection('**hello**'));

    expect(onContentChange).toHaveBeenCalledWith('**hello** world');
    expect(editorRef.current.getValue()).toBe('**hello** world');
  });

  it('has no rich-text editing surface left', () => {
    const { container } = setup({ content: 'plain markdown' });
    expect(container.querySelector('.ProseMirror')).toBeNull();
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
  });
});
