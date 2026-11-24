import { useCallback, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured } from '../services/supabase';
import { isPlaceholderNoteId } from '../constants/notes';
import { notesApi } from '../services/notes-api';

export const MESSAGE_POLL_MS = 5000;

/**
 * The thread on the open note.
 *
 * A conversation between a person and their agents, stored as rows, so it
 * survives a redeploy and a closed tab — unlike presence, which is a heartbeat
 * and is supposed to disappear. The point of the thread is narrow and load
 * bearing: an agent that wants to change the note writes a *proposal* here
 * instead of writing into the note. The agent's text then arrives as something a
 * person reads and applies, not as a rewrite they discover afterwards.
 *
 * Polling with a cursor, the same way the agent polls its own changes: a quiet
 * note costs one empty answer every five seconds, and the browser stops asking
 * while its tab is hidden.
 *
 * Nothing here is fatal. If the server is unreachable the last answer stands and
 * the panel shows what it could not read; a thread must never break the editor.
 */
function byTime(messages) {
  return [...messages].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || String(a.id).localeCompare(String(b.id))
  );
}

function newestStamp(messages) {
  let newest = null;
  for (const message of messages) {
    for (const stamp of [message.createdAt, message.decidedAt]) {
      if (!stamp) continue;
      if (!newest || Date.parse(stamp) > Date.parse(newest)) newest = stamp;
    }
  }
  return newest;
}

export function useThread({ noteId, enabled = true }) {
  const [state, setState] = useState({ status: 'idle', messages: [], notice: null });
  const cursorRef = useRef(null);
  const noteIdRef = useRef(null);

  const reset = useCallback(() => {
    cursorRef.current = null;
    noteIdRef.current = null;
    setState({ status: 'idle', messages: [], notice: null });
  }, []);

  const read = useCallback(
    async ({ initial = false } = {}) => {
      if (!noteId || isPlaceholderNoteId(noteId)) return;
      if (!isSupabaseConfigured()) {
        setState({ status: 'ready', messages: [], notice: 'threadLocalOnly' });
        return;
      }
      // A new note starts a new thread: the cursor belongs to the note it came
      // from, and reusing it would skip messages on the note now on screen.
      const since = noteIdRef.current === noteId ? cursorRef.current : null;
      noteIdRef.current = noteId;
      try {
        const page = await notesApi.messages(noteId, since);
        const incoming = Array.isArray(page) ? page : Array.isArray(page?.data) ? page.data : [];
        setState((previous) => {
          if (noteIdRef.current !== noteId) return previous;
          if (initial) return { status: 'ready', messages: byTime(incoming), notice: null };
          // Replace by id, never append by id-not-seen: a proposal applied in
          // another tab comes back as the same message with a decision on it,
          // and the older copy is the one that still offers Apply.
          const byId = new Map(previous.messages.map((message) => [message.id, message]));
          for (const message of incoming) byId.set(message.id, message);
          return { status: 'ready', messages: byTime([...byId.values()]), notice: null };
        });
        // The cursor covers creation and decision, so a message that is decided
        // later does not drag it backwards and get re-read on every tick.
        const newest = newestStamp(incoming);
        if (newest) cursorRef.current = newest;
      } catch (error) {
        setState((previous) => ({
          ...previous,
          status: 'ready',
          // A failure to read a conversation is not a failure to save the note,
          // so it is said plainly and left alone rather than thrown at the editor.
          notice: previous.messages.length ? 'threadStale' : 'threadUnavailable',
        }));
        if (error?.status === 503) setState((previous) => ({ ...previous, notice: 'threadLocalOnly' }));
      }
    },
    [noteId]
  );

  useEffect(() => {
    reset();
    if (!noteId || !enabled) return undefined;

    let alive = true;
    const tick = () => {
      if (!alive) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      void read({ initial: false });
    };

    void read({ initial: true });
    const timer = setInterval(tick, MESSAGE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [noteId, enabled, read, reset]);

  const post = useCallback(
    async (body, { kind = 'note', baseRevision } = {}) => {
      if (!noteId || isPlaceholderNoteId(noteId)) return null;
      const message = await notesApi.postMessage(noteId, { body, kind, baseRevision });
      // The poll would find it a few seconds later; putting it in now keeps the
      // thread from looking like the message did not send.
      if (message?.id) {
        setState((previous) => ({ ...previous, messages: [...previous.messages, message] }));
        cursorRef.current = message.createdAt || cursorRef.current;
      }
      return message;
    },
    [noteId]
  );

  const decide = useCallback(
    async (messageId, applied) => {
      if (!noteId) return null;
      const updated = await notesApi.decideMessage(noteId, messageId, applied);
      if (updated?.id) {
        setState((previous) => ({
          ...previous,
          messages: previous.messages.map((message) =>
            message.id === updated.id ? updated : message
          ),
        }));
      }
      return updated;
    },
    [noteId]
  );

  return { ...state, post, decide, refresh: read };
}
