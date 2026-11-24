import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, X } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { PanelEmpty, PanelError, PanelLoading } from './HelperPanel';
import { noticeText, noticeTone } from '../services/notices';
import { activitySentence, actorLabel, readAgentActivity } from '../services/agent-activity';
import { formatRelativeTime } from '../utils/time';

/**
 * Agent activity — what the agent did to the notes, and when.
 *
 * Slice 4's audit item, the surface half. The events have been written since
 * the agent note routes landed (`agent_audit_log`, one row per create and
 * update) and there was nowhere to see them: the trail is the half of "your
 * agent can write into your notes" that makes the promise checkable, because a
 * reader who cannot see what changed has to trust instead of look.
 *
 * It is read from the server, newest first, scoped to the owner of the notes —
 * so the panel states what it could not read rather than showing an empty list
 * when there is nothing to read from. In local mode (no account, the shipped
 * default) that is the state it opens in, and it says so in one line.
 *
 * Reachable from the command palette, like the storage panel: the notebook
 * itself does not grow a status row for a fact that is only there when a
 * backend is.
 */

export default function AgentActivity({ isOpen, onClose, notes = [], read = readAgentActivity }) {
  const containerRef = useRef(null);
  const [state, setState] = useState({ status: 'idle', events: [], hasMore: false, notice: null });

  useFocusTrap(containerRef, isOpen, { onClose });

  const applyResult = useCallback((result) => {
    setState({
      status: 'ready',
      events: result.ok ? result.events : [],
      hasMore: Boolean(result.hasMore),
      notice: result.notice || (result.ok && result.events.length === 0 ? 'activityEmpty' : null),
    });
  }, []);

  const load = useCallback(async () => {
    setState((previous) => ({ ...previous, status: 'loading' }));
    applyResult(await read());
  }, [read, applyResult]);

  useEffect(() => {
    if (!isOpen) return undefined;
    let isActive = true;
    setState((previous) => ({ ...previous, status: 'loading' }));
    // The read carries a token: a close while it is in flight must not put its
    // answer on a panel that is gone.
    read().then((result) => {
      if (isActive) applyResult(result);
    });
    return () => {
      isActive = false;
    };
  }, [isOpen, read, applyResult]);

  if (!isOpen) return null;

  const titleById = new Map(notes.map((note) => [note.id, note.title]));
  const noteTitle = (event) => event?.metadata?.title || titleById.get(event?.noteId) || null;
  const isError = state.notice && noticeTone(state.notice) === 'error';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        className="w-full max-w-lg overflow-hidden rounded-lg border border-gray-700/50 bg-gray-800 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-activity-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-700/50 px-6 py-4">
          <h2
            id="agent-activity-title"
            className="flex items-center gap-2 text-base font-semibold tracking-[-0.01em] text-gray-100"
          >
            <Bot className="h-4 w-4 text-gray-400" aria-hidden="true" />
            Agent activity
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close agent activity"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition-colors duration-200 hover:bg-gray-700/50 hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {state.status !== 'ready' ? (
          <PanelLoading label="Reading the trail…" />
        ) : state.notice ? (
          isError ? (
            <PanelError message={noticeText(state.notice)} onRetry={load} />
          ) : (
            <PanelEmpty message={noticeText(state.notice)} />
          )
        ) : (
          <div className="px-6 py-5">
            <ul className="divide-y divide-gray-700/50">
              {state.events.map((event) => (
                <li
                  key={event.eventId || `${event.noteId}-${event.createdAt}`}
                  className="flex items-baseline justify-between gap-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-gray-200">
                      {activitySentence(event, noteTitle(event))}
                    </p>
                    <p className="truncate text-xs text-gray-400">by {actorLabel(event)}</p>
                  </div>
                  {/* The trail carries an ISO string and the formatter counts
                      milliseconds, so the conversion is here, not in the util. */}
                  <time
                    className="flex-shrink-0 text-xs text-gray-400"
                    dateTime={event.createdAt || undefined}
                  >
                    {formatRelativeTime(Date.parse(event.createdAt))}
                  </time>
                </li>
              ))}
            </ul>

            <p className="mt-4 text-xs text-gray-400">
              {state.hasMore
                ? `Showing the newest ${state.events.length} events.`
                : 'Every note an agent creates or edits through the API is recorded here, newest first.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
