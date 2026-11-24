import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_TTL_MS,
  createThrottle,
  decodePresence,
  encodePresence,
  isFresh,
  livePresence,
} from '../services/presence-codec';
import { isSupabaseConfigured } from '../services/supabase';
import { isPlaceholderNoteId } from '../constants/notes';
import { notesApi } from '../services/notes-api';

export const PRESENCE_CHANNEL = 'canonote-presence';

/**
 * The caret goes to the server at most this often. An agent needs a position it
 * can act on, not every keystroke; the 4 s heartbeat below keeps it alive.
 */
export const PRESENCE_SERVER_MIN_INTERVAL_MS = 1000;

/**
 * Who else is in this note.
 *
 * Two transports, one list.
 *
 * People ride a BroadcastChannel: two tabs on one laptop see each other with no
 * server, no account and no network. Agents cannot join a browser channel, so an
 * agent announces a mode and a range through its API and the browser polls once
 * every three seconds while a note is open. Same TTL on both sides, so an agent
 * that stops heartbeating disappears exactly like a closed tab.
 *
 * Presence never blocks anything. If the channel is missing or closed, `others`
 * stays empty and the editor behaves exactly as before.
 */
export function usePresence({ noteId, name = 'Someone', caret = null }) {
  const selfId = useMemo(() => `u-${Math.random().toString(36).slice(2, 10)}`, []);
  const [humans, setHumans] = useState([]);
  const [agents, setAgents] = useState([]);
  const entriesRef = useRef(new Map());
  const channelRef = useRef(null);
  const throttleRef = useRef(null);
  const caretRef = useRef(caret);
  const nameRef = useRef(name);

  useEffect(() => {
    caretRef.current = caret;
    nameRef.current = name;
  }, [caret, name]);

  const send = useCallback((from) => {
    const channel = channelRef.current;
    const throttle = throttleRef.current;
    if (!channel || !throttle) return;
    throttle.push(
      encodePresence({ kind: 'human', id: selfId, name: nameRef.current, from, to: from }),
      (payload) => channel.postMessage(payload)
    );
  }, [selfId]);

  useEffect(() => {
    if (!noteId || typeof BroadcastChannel === 'undefined') {
      setHumans([]);
      return undefined;
    }

    const channel = new BroadcastChannel(`${PRESENCE_CHANNEL}:${noteId}`);
    channelRef.current = channel;
    throttleRef.current = createThrottle();
    entriesRef.current = new Map();
    setHumans([]);

    channel.onmessage = (event) => {
      const entry = decodePresence(event.data);
      if (!entry || entry.id === selfId) return;
      entriesRef.current.set(entry.id, entry);
      setHumans(livePresence([...entriesRef.current.values()], { selfId }));
    };

    const beat = () => send(caretRef.current);
    beat();
    const heartbeat = setInterval(beat, PRESENCE_HEARTBEAT_MS);
    const prune = setInterval(
      () => setHumans(livePresence([...entriesRef.current.values()], { selfId })),
      2000
    );

    return () => {
      clearInterval(heartbeat);
      clearInterval(prune);
      throttleRef.current?.stop();
      throttleRef.current = null;
      channel.onmessage = null;
      channel.close();
      channelRef.current = null;
    };
  }, [noteId, selfId, send]);

  // Agents cannot post into a BroadcastChannel, so while a note is open the browser
  // asks the server who is working in it. A failed poll keeps the last answer: a
  // dropped request should not make the agent blink out of the footer.
  useEffect(() => {
    // The placeholder is not a note: asking the server about it is a guaranteed
    // 404 in the console on every first load.
    if (!noteId || isPlaceholderNoteId(noteId) || !isSupabaseConfigured()) {
      setAgents([]);
      return undefined;
    }
    let alive = true;
    let lastRevision = null;
    const read = async () => {
      try {
        const payload = await notesApi.presence(noteId);
        const entries = payload?.entries || payload?.data?.entries || [];
        // The caret poll carries the note's revision, so an agent's write is
        // noticed for free: no socket, no webhook, no second request. The editor
        // decides what to do with it - a clean pane takes the new text, a dirty
        // one keeps its draft and lets the next CAS save answer.
        const revision = payload?.revision ?? payload?.data?.revision ?? null;
        if (revision !== null && revision !== lastRevision) {
          const moved = lastRevision === null ? true : Number(revision) > Number(lastRevision);
          lastRevision = revision;
          if (moved && alive) {
            window.dispatchEvent(
              new CustomEvent('canonote:remote-revision', { detail: { noteId, revision } })
            );
          }
        }
        if (!alive) return;
        setAgents(entries.filter((entry) => isFresh(entry, Date.now(), PRESENCE_TTL_MS)));
      } catch {
        /* the last answer stands; presence is never worth an error message */
      }
    };
    read();
    const timer = setInterval(read, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [noteId]);

  const others = useMemo(
    () => livePresence([...humans, ...agents], { selfId }),
    [humans, agents, selfId]
  );

  /**
   * The same caret, for an agent. A BroadcastChannel is one machine's memory, so
   * the person's position has to be written to the server for anyone without a
   * tab to read it. Leading edge plus one trailing send: typing fast costs one
   * request a second, and the last position always lands.
   */
  const serverRef = useRef({ at: 0, timer: null });

  const publishToServer = useCallback(
    (index) => {
      if (!noteId || isPlaceholderNoteId(noteId) || !isSupabaseConfigured()) return;
      if (!Number.isInteger(index)) return;
      const state = serverRef.current;
      const wait = PRESENCE_SERVER_MIN_INTERVAL_MS - (Date.now() - state.at);
      if (wait > 0) {
        if (state.timer) return;
        state.timer = setTimeout(() => {
          state.timer = null;
          publishToServer(caretRef.current);
        }, wait);
        return;
      }
      state.at = Date.now();
      try {
        notesApi.announcePresence?.(noteId, { from: index })?.catch(() => {
          /* presence is a courtesy: a refused caret never reaches the editor */
        });
      } catch {
        /* a presence write is never worth an error message */
      }
    },
    [noteId]
  );

  // A caret that stops moving still has to stay alive: an agent reading an empty
  // presence would think the person left the note.
  useEffect(() => {
    if (!noteId || isPlaceholderNoteId(noteId) || !isSupabaseConfigured()) return undefined;
    const beat = setInterval(() => publishToServer(caretRef.current), PRESENCE_HEARTBEAT_MS);
    return () => {
      clearInterval(beat);
      const state = serverRef.current;
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
    };
  }, [noteId, publishToServer]);

  /** Called on every caret move; the throttle decides how much of it travels. */
  const publishCaret = useCallback(
    (index) => {
      if (!Number.isInteger(index)) return;
      send(index);
      publishToServer(index);
    },
    [send, publishToServer]
  );

  return { others, publishCaret, selfId };
}
