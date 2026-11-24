// SelectionToolbar - Inline bubble menu for the current text selection.
// Default view: quick formatting (bold/italic/underline/strike, headings, link).
import React, { useEffect, useRef } from 'react';
import { Bold, Italic, Underline, Strikethrough, Link } from 'lucide-react';

const fmtButtonClass =
  'inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-300 transition-[transform,background-color,color] duration-150 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 active:scale-[0.94]';
const fmtActiveClass = 'bg-accent-600/30 text-accent-200';

export default function SelectionToolbar({
  position,
  onClose,
  activeFormats = {},
  onFormat,
  onInsertHeading,
  onInsertLink,
}) {
  const toolbarRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!position) return null;
  const rawLeft = position.left ?? position.x ?? 0;
  const top = (position.top ?? position.y ?? 0) + 10;
  // Keep the bubble within the viewport horizontally (it is centered on rawLeft).
  const left =
    typeof window !== 'undefined'
      ? Math.min(Math.max(rawLeft, 140), window.innerWidth - 140)
      : rawLeft;

  // Prevent the editor from blurring / collapsing the selection on click.
  const keepSelection = (e) => e.preventDefault();

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="Selection actions"
      onMouseDown={keepSelection}
      className="selection-toolbar fixed z-50 flex items-center gap-0.5 rounded-lg border border-gray-700/80 bg-gray-900/95 p-1 shadow-lg"
      style={{ left, top, transform: 'translateX(-50%)' }}
    >
      <button
            type="button"
            onClick={() => onFormat?.('**')}
            className={`${fmtButtonClass} ${activeFormats.bold ? fmtActiveClass : ''}`}
            title="Bold"
            aria-label="Bold"
            aria-pressed={!!activeFormats.bold}
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onFormat?.('*')}
            className={`${fmtButtonClass} ${activeFormats.italic ? fmtActiveClass : ''}`}
            title="Italic"
            aria-label="Italic"
            aria-pressed={!!activeFormats.italic}
          >
            <Italic className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onFormat?.('_')}
            className={`${fmtButtonClass} ${activeFormats.underline ? fmtActiveClass : ''}`}
            title="Underline"
            aria-label="Underline"
            aria-pressed={!!activeFormats.underline}
          >
            <Underline className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onFormat?.('~~')}
            className={`${fmtButtonClass} ${activeFormats.strike ? fmtActiveClass : ''}`}
            title="Strikethrough"
            aria-label="Strikethrough"
            aria-pressed={!!activeFormats.strike}
          >
            <Strikethrough className="h-4 w-4" />
          </button>

          <div className="mx-1 h-5 w-px bg-gray-700/70" aria-hidden="true" />

          {[1, 2, 3].map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => onInsertHeading?.(level)}
              className={`${fmtButtonClass} text-xs font-bold`}
              title={`Heading ${level}`}
              aria-label={`Heading ${level}`}
            >
              H{level}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onInsertLink?.()}
            className={fmtButtonClass}
            title="Link"
            aria-label="Insert link"
          >
            <Link className="h-4 w-4" />
          </button>
    </div>
  );
}
