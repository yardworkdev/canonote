import React from 'react';
import { Copy } from 'lucide-react';
import MarkdownEditor from './MarkdownEditor';

// Editor renders the markdown source surface for one pane.
// Content is a markdown string end to end: `content` in, `onContentChange`
// out. There is no HTML conversion and no rich-text document model.
export default function Editor({
  editorRef,
  content = '',
  onContentChange,
  onKeyDown,
  onCopy,
  copied,
  isActive = true,
  splitViewEnabled = false,
  onFocusPane,
  spans = [],
  remoteRanges = [],
  currentNoteId = '',
  contentLoading = false,
  readOnly = false,
}) {
  return (
    <div
      className={`relative w-full rounded-lg transition-[box-shadow] duration-200 sm:rounded-[1.25rem] ${
        splitViewEnabled && isActive ? 'shadow-soft ring-1 ring-accent-500/25' : ''
      }`}
      style={{ width: '100%' }}
    >
      {/* One measure, anchored to the left edge of the pane. The column was
          centred before; Ves, 2026-11-08: "the text is in the center, make it
          start from the left side". A note is read left to right from a fixed
          margin, not floated in the middle of a screen. */}
      <div className="w-full max-w-[44rem]">
        <MarkdownEditor
          ref={editorRef}
          value={content}
          onChange={onContentChange}
          onKeyDown={onKeyDown}
          onFocus={() => onFocusPane?.()}
          spans={spans}
          spansKey={currentNoteId}
          remoteRanges={remoteRanges}
          placeholder={readOnly ? 'Creating note…' : contentLoading ? 'Loading note…' : 'Start writing…'}
          readOnly={readOnly}
          ariaLabel="Note editor"
          className="block min-h-[70vh] w-full resize-none bg-transparent px-2 py-2 font-note text-[16px] leading-[1.75] text-gray-200 outline-none sm:min-h-[calc(100vh-11rem)] sm:px-4 sm:py-4 lg:px-6 lg:py-6"
        />
      </div>
      {onCopy && (
        <button
          onClick={onCopy}
          className="absolute bottom-4 left-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-gray-900/60 text-gray-300 transition-[transform,background-color,color,box-shadow] duration-200 hover:bg-gray-800/80 hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 active:scale-[0.96]"
          title="Copy All Content"
          aria-label="Copy all content"
        >
          <Copy
            className={`w-4 h-4 transition-colors ${copied ? 'text-green-400' : 'text-gray-300'}`}
          />
        </button>
      )}
    </div>
  );
}
