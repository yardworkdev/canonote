import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, Bot, MessageSquare } from 'lucide-react';
import { PanelEmpty, PanelError, PanelLoading } from './HelperPanel';
import { noticeText, noticeTone } from '../services/notices';

/**
 * The thread on this note — the place a person and their agent talk.
 *
 * Why it is a panel and not a chat bubble bolted onto the editor: the thing being
 * said is usually a *change to the note*, and a change has to be reviewable. So a
 * message from an agent can be a proposal, which carries the revision it was
 * written against; the person sees the proposed text in full, applies it or
 * dismisses it, and applying writes it through the editor's own guarded save.
 * That is the whole safety story in one control: the agent never had the key to
 * the text, it offered a paragraph and a person put it in.
 *
 * Everything is read from the server, so a message survives a reload and so does
 * the night. In local-only mode there is no thread and the panel says so in one
 * line rather than looking broken.
 *
 * The look follows DESIGN.md — one radius, no glass — but authorship is now a
 * surface, not a label: a message from an agent sits on the agent surface with a
 * rule down its left edge and an AGENT chip, in every theme (Ves, 2026-11-18:
 * "it should have a different background, and it should be very clearly a
 * different thing"). The only other colour here is the outcome of a decision.
 */

const timeOf = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const kindLabel = (message) => {
  if (message.kind === 'proposal') return 'proposal';
  return null;
};

export default function NoteThread({
  noteId,
  messages = [],
  status = 'ready',
  notice = null,
  onPost,
  onDecide,
  onApply,
  onNotice,
  baseRevision = null,
}) {
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const listRef = useRef(null);
  const endRef = useRef(null);

  // A conversation reads newest-last, so the view follows the last message when
  // something new arrives — unless the person has scrolled up to read.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    if (nearBottom && typeof endRef.current?.scrollIntoView === 'function') {
      endRef.current.scrollIntoView({ block: 'end' });
    }
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || pending) return;
    setPending(true);
    try {
      await onPost?.(body, { kind: 'note' });
      setDraft('');
      onNotice?.('threadPosted');
    } catch {
      onNotice?.('threadPostFailed');
    } finally {
      setPending(false);
    }
  };

  const decide = async (message, applied) => {
    try {
      if (applied) {
        const outcome = await onApply?.(message);
        // `stale` is a real answer, not a failure: the note moved on since the
        // proposal was written, so the text was left out and the person is told.
        if (outcome === 'stale') {
          onNotice?.('proposalAppliedStale');
          await onDecide?.(message.id, false);
          return;
        }
        onNotice?.('proposalApplied');
      } else {
        onNotice?.('proposalDismissed');
      }
      await onDecide?.(message.id, applied);
    } catch {
      onNotice?.('threadPostFailed');
    }
  };

  const isError = notice && noticeTone(notice) === 'error';

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="note-thread">
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {status === 'idle' || status === 'loading' ? (
          <PanelLoading label="Reading the thread…" />
        ) : isError ? (
          <PanelError message={noticeText(notice)} />
        ) : messages.length === 0 ? (
          <PanelEmpty message={notice ? noticeText(notice) : noticeText('threadEmpty')} />
        ) : (
          <ul className="space-y-3">
            {messages.map((message) => {
              const mine = message.authorType === 'human';
              const decided = message.kind === 'proposal' && Boolean(message.decidedAt || message.appliedAt);
              const stale =
                message.kind === 'proposal' &&
                Number.isInteger(message.baseRevision) &&
                Number.isInteger(baseRevision) &&
                message.baseRevision !== baseRevision;
              return (
                <li
                  key={message.id}
                  className="thread-message"
                  data-author={message.authorType}
                  data-kind={message.kind}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="flex min-w-0 items-center gap-1.5 text-xs text-gray-400">
                      {mine ? (
                        <span className="thread-author truncate font-medium text-gray-300">You</span>
                      ) : (
                        <>
                          {/* The chip is the point, not decoration: a raised panel
                              plus a label means an agent's words can never be
                              mistaken for the note's author at a glance. */}
                          <span className="thread-kind inline-flex flex-shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]">
                            <Bot className="h-3 w-3" aria-hidden="true" />
                            Agent
                          </span>
                          <span className="thread-author truncate font-medium">
                            {message.authorName || 'Agent'}
                          </span>
                        </>
                      )}
                      {kindLabel(message) ? (
                        <span className="thread-kind flex-shrink-0 rounded bg-gray-700/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-300">
                          {kindLabel(message)}
                        </span>
                      ) : null}
                    </p>
                    <time className="thread-time flex-shrink-0 text-xs text-gray-400" dateTime={message.createdAt || undefined}>
                      {timeOf(message.createdAt)}
                    </time>
                  </div>

                  {/* A proposal is text for the note, so it is shown as text,
                      not styled as a chat bubble: what you read is what lands. */}
                  <p
                    className={
                      message.kind === 'proposal'
                        ? 'thread-proposal mt-2 whitespace-pre-wrap break-words rounded bg-white/[0.04] p-2 font-mono text-[13px] leading-relaxed text-gray-200'
                        : 'thread-body mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-200'
                    }
                  >
                    {message.body}
                  </p>

                  {message.kind === 'proposal' ? (
                    decided ? (
                      <p className="mt-2 text-xs text-gray-400">
                        {message.appliedAt ? 'Applied.' : 'Dismissed.'}
                      </p>
                    ) : (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => decide(message, true)}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-600 px-2.5 py-1 text-xs text-gray-200 transition-colors hover:bg-gray-700/50"
                        >
                          <ArrowDown className="h-3 w-3" aria-hidden="true" />
                          Apply
                        </button>
                        <button
                          type="button"
                          onClick={() => decide(message, false)}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-700 px-2.5 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-700/40 hover:text-gray-200"
                        >
                          Dismiss
                        </button>
                        {stale ? (
                          <span className="text-xs text-amber-400">
                            written for revision {message.baseRevision}, the note is at {baseRevision}
                          </span>
                        ) : null}
                      </div>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      <div className="flex-shrink-0 border-t border-gray-700/50 px-4 py-2">
        <label className="sr-only" htmlFor="note-thread-input">
          Message about this note
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="note-thread-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={
              noteId ? 'Write to your agent about this note…' : 'Open a note to start a thread'
            }
            disabled={!noteId}
            className="min-h-[44px] w-full resize-none rounded-lg border border-gray-700/60 bg-transparent px-2.5 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={send}
            disabled={!noteId || pending || draft.trim().length === 0}
            className="inline-flex h-9 flex-shrink-0 items-center gap-1.5 rounded-lg border border-gray-600 px-3 text-xs text-gray-200 transition-colors hover:bg-gray-700/50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
            Send
          </button>
        </div>
        <p className="mt-1 text-[11px] text-gray-400">
          Your agent can read and answer this. A change it wants arrives as a proposal to apply.
        </p>
      </div>
    </div>
  );
}
