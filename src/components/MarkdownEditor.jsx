// MarkdownEditor - the markdown source surface for a note.
//
// It is deliberately dumb: a controlled <textarea> that renders the note's
// markdown string and exposes selection / insertion helpers through an
// imperative ref. It contains NO formatting logic - callers (useEditorPane)
// build markdown edits from these primitives.
import React, { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { remapSpans } from '../lib/attribution';

// One tint per other writer, stable for the length of a session. Chosen to stay
// legible on both themes' paper without being the accent, which means "you".
const REMOTE_TINTS = ['#7aa2d6', '#c98f5a', '#8fbf8a', '#b98fd0'];

const MarkdownEditor = forwardRef(function MarkdownEditor(
  {
    value = '',
    onChange,
    onKeyDown,
    placeholder = '',
    readOnly = false,
    className = '',
    onFocus,
    ariaLabel = 'Note editor',
    // Character ranges written by an agent, `[{ start, end }]` in this value.
    // They are painted as a background behind the text, the way a shared
    // document marks the words that are not yours.
    spans = [],
    // Identity of the note these spans belong to; a change resets the tracking.
    spansKey = '',
    // Other writers in this note right now: `[{ id, name, from, to }]`. `from` is
    // their caret, `from..to` their selection. Rendered on the same mirror as the
    // agent's band, so a caret sits on the character it names rather than on the
    // line it happens to share.
    remoteRanges = [],
  },
  ref
) {
  const textareaRef = useRef(null);
  const backdropRef = useRef(null);
  // Spans are offsets into the text, so they have to move when the text moves.
  // Tracking them locally keeps the band glued to the agent's words while the
  // person types; the server sends the authoritative ranges on the next load.
  //
  // Which of the two happened is decided by the ranges themselves, not by the
  // identity of the array: a remote write arrives as new text *and* new ranges in
  // one render, and remapping the old ranges onto the new text threw the band away
  // (measured: an agent's paragraph arrived with 0 marked runs). Identity is not a
  // signal either — a caller passing `spans || []` hands over a fresh empty array
  // on every render.
  const spanSignature = (list) =>
    (list || []).map((span) => `${span.start}-${span.end}`).join(',');
  const trackedRef = useRef({ key: spansKey, value, spans, signature: spanSignature(spans) });
  const incomingSignature = spanSignature(spans);
  if (trackedRef.current.key !== spansKey) {
    trackedRef.current = { key: spansKey, value, spans, signature: incomingSignature };
  } else if (trackedRef.current.signature !== incomingSignature) {
    // The ranges are new, so they describe the text that came with them.
    trackedRef.current = { key: spansKey, value, spans, signature: incomingSignature };
  } else if (trackedRef.current.value !== value) {
    const moved = remapSpans(trackedRef.current.spans, trackedRef.current.value, value);
    trackedRef.current = { key: spansKey, value, spans: moved, signature: spanSignature(moved) };
  }
  const liveSpans = trackedRef.current.spans;

  // Replace the current selection with `text` and leave the caret after it.
  // Writing the DOM value first keeps the caret stable; React skips the
  // re-render write because the value prop ends up identical.
  const writeSelection = (text) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const nextValue = el.value.slice(0, start) + text + el.value.slice(end);
    el.value = nextValue;
    const caret = start + text.length;
    el.setSelectionRange(caret, caret);
    onChange?.(nextValue);
  };

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        textareaRef.current?.focus();
      },
      getElement() {
        return textareaRef.current;
      },
      getSelection() {
        const el = textareaRef.current;
        if (!el) return { start: 0, end: 0, text: '' };
        return {
          start: el.selectionStart,
          end: el.selectionEnd,
          text: el.value.slice(el.selectionStart, el.selectionEnd),
        };
      },
      setSelection(start, end = start) {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(start, end);
      },
      // insertAtCursor and replaceSelection behave the same for a textarea:
      // the selected text (if any) is replaced by `text`. Both are kept
      // because they read differently at call sites.
      insertAtCursor(text) {
        writeSelection(text);
      },
      replaceSelection(text) {
        writeSelection(text);
      },
      getValue() {
        return textareaRef.current ? textareaRef.current.value : value;
      },
      setValue(nextValue) {
        const el = textareaRef.current;
        if (!el) return;
        el.value = nextValue;
        onChange?.(nextValue);
      },
    }),
    [value, onChange]
  );

  // Split the text into runs at every boundary that matters — the agent's marks and
  // any other person's caret or selection. The backdrop renders the same characters
  // in the same font, so its boxes sit exactly behind the words: a caret drawn here
  // is therefore on the character it names, not merely on the same line.
  const remote = (remoteRanges || [])
    .filter((entry) => entry && Number.isInteger(entry.from) && entry.from <= value.length)
    .map((entry, index) => ({ ...entry, tint: entry.tint || REMOTE_TINTS[index % REMOTE_TINTS.length] }));

  const cuts = new Set([0, value.length]);
  for (const span of liveSpans) {
    cuts.add(Math.max(0, Math.min(span.start, value.length)));
    cuts.add(Math.max(0, Math.min(span.end, value.length)));
  }
  for (const entry of remote) {
    cuts.add(entry.from);
    if (Number.isInteger(entry.to)) cuts.add(Math.max(entry.from, Math.min(entry.to, value.length)));
  }
  const points = [...cuts].sort((a, b) => a - b);

  const segments = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;
    const marked = liveSpans.some((span) => span.start <= start && span.end >= end);
    const owner = remote.find(
      (entry) => Number.isInteger(entry.to) && entry.from <= start && entry.to >= end
    );
    const caret = remote.find((entry) => entry.from === start);
    segments.push({ start, end, text: value.slice(start, end), marked, owner, caret });
  }

  // Move the band with a transform, not by scrolling a second box.
  //
  // Two scroll containers can never agree exactly: their content heights differ by a
  // trailing line, so at the end of the scroll the mirror clamps early and the band
  // drifts — and every scroll event is one frame late, which reads as the band
  // bouncing behind the words (Ves, 2026-11-18: "the background is just bouncy").
  // A transform has nothing to clamp and is applied on the compositor.
  const syncScroll = () => {
    const textarea = textareaRef.current;
    const backdrop = backdropRef.current;
    if (!textarea || !backdrop) return;
    backdrop.style.transform = `translate3d(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px, 0)`;
  };

  // The backdrop is a separate box; it only follows the textarea if something
  // tells it to. `onScroll` covers a person dragging the wheel, and that is all
  // it used to cover: opening a long note scrolls the textarea to the caret
  // without any scroll event reaching the (not yet mounted) backdrop, so the
  // band was drawn at scrollTop 0 while the text sat at 192 — measured on
  // production, the mark was entirely below the fold. Sync after every render,
  // and once more on the next frame because the browser scrolls to the caret
  // after layout.
  useLayoutEffect(() => {
    syncScroll();
    const frame = requestAnimationFrame(syncScroll);
    return () => cancelAnimationFrame(frame);
  });

  return (
    <div className="relative overflow-hidden">
      {(segments.some((segment) => segment.marked || segment.owner || segment.caret) ||
        remote.some((entry) => entry.from === value.length)) && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            ref={backdropRef}
            data-agent-highlights="true"
            className={`absolute left-0 top-0 w-full whitespace-pre-wrap break-words text-transparent ${className}`}
            style={{ willChange: 'transform', transform: 'translate3d(0, 0, 0)' }}
          >
            {segments.map((segment) => (
              <React.Fragment key={segment.start}>
                {segment.caret && (
                  <span
                    className="remote-caret"
                    data-remote-author={segment.caret.name || 'someone'}
                    style={{ '--remote-tint': segment.caret.tint }}
                  />
                )}
                {segment.marked || segment.owner ? (
                  <span
                    className={[
                      segment.marked ? 'agent-mark' : '',
                      segment.owner ? 'remote-selection' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    data-agent-span={segment.marked ? 'true' : undefined}
                    data-remote-selection={segment.owner ? segment.owner.name : undefined}
                    style={segment.owner ? { '--remote-tint': segment.owner.tint } : undefined}
                  >
                    {segment.text}
                  </span>
                ) : (
                  segment.text
                )}
              </React.Fragment>
            ))}
            {remote
              .filter((entry) => entry.from === value.length)
              .map((entry) => (
                <span
                  key={`caret-end-${entry.id}`}
                  className="remote-caret"
                  data-remote-author={entry.name || 'someone'}
                  style={{ '--remote-tint': entry.tint }}
                />
              ))}
            {'\n'}
          </div>
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          onChange?.(event.target.value);
          syncScroll();
        }}
        onScroll={syncScroll}
        onKeyDown={(event) => onKeyDown?.(event, textareaRef.current)}
        onFocus={(event) => onFocus?.(event)}
        placeholder={placeholder}
        readOnly={readOnly}
        spellCheck="true"
        className={`relative bg-transparent ${className}`}
        aria-label={ariaLabel}
        style={{ caretColor: 'rgb(var(--accent-400))' }}
      />
    </div>
  );
});

export default MarkdownEditor;
