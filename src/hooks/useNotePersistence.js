import { useCallback, useEffect, useRef, useState } from 'react';
import { describeStorageFailure } from '../services/storage-failure';
import { describeSaveOutcome } from '../services/save-outcome';
import { notesApi, NotesApiError } from '../services/notes-api';
import { isSupabaseConfigured } from '../services/supabase';
import { isNoteDeleted } from '../services/deleted-notes';
import { recordNoteVersion } from '../services/note-history';
import { previewFromMarkdown, titleFromMarkdown } from '../utils/markdown';
import { logSaveDebug } from '../utils/saveDebugLogger';
import { PLACEHOLDER_NOTE_ID } from '../constants/notes';
import { createNoteId } from '../utils/ids';
import { commitNoteContent, draftKeyFor, parseDraft, serializeDraft } from '../services/note-journal';
import { writeBrowserStorageValue } from '../services/browser-storage';

const NOTES_BROADCAST_CHANNEL = 'notes-sync';

let broadcastChannelRef = null;

const getBroadcastChannel = () => {
  if (!broadcastChannelRef) {
    broadcastChannelRef = new BroadcastChannel(NOTES_BROADCAST_CHANNEL);
  }
  return broadcastChannelRef;
};

const normalizeApiNote = (row) => {
  if (!row || typeof row !== 'object') return null;
  return {
    id: row.id || row.note_id,
    title: row.title || 'Untitled',
    updated: Number.isFinite(row.updated)
      ? row.updated
      : new Date(row.updated_at || Date.now()).getTime(),
    isPinned: Boolean(row.isPinned || row.is_pinned),
    folder: row.folder || 'private',
    createdBy: row.createdBy || row.created_by || null,
    createdByName: row.createdByName || row.created_by_name || null,
    revision: typeof row.revision === 'string' ? row.revision : null,
    content: typeof row.content === 'string' ? row.content : '',
    // Character ranges an agent wrote, in this note's current text. They arrive
    // with the body, so reading a note costs one request, not two.
    agentSpans: Array.isArray(row.agentSpans)
      ? row.agentSpans
      : Array.isArray(row.agent_spans)
        ? row.agent_spans
        : [],
  };
};

const broadcastNotesChanged = (detail = {}) => {
  if (!('BroadcastChannel' in window)) return;
  getBroadcastChannel().postMessage({ type: 'notes-changed', ...detail });
};

export const useNotePersistence = ({
  paneId,
  user,
  storage,
  noteId,
  notes,
  resolvedNote,
  editorRef,
  content,
  setContent,
  contentRef,
  contentEditVersionRef,
  lastContentRef,
  hasConflict,
  hasConflictRef,
  conflictSnapshotRef,
  conflictMessage,
  readPersistedConflictSnapshot,
  applyConflictSnapshot,
  setConflictRecovery,
  clearConflictRecovery,
  clearPersistedConflictSnapshot,
  restoreConflictDraftContent,
}) => {
  const [saveStatus, setSaveStatus] = useState('idle');
  // An open note has to fetch its canonical text. Saying so is cheaper than
  // showing an empty page for the seconds that takes — an empty page reads as
  // lost data to anyone who has ever lost data.
  const [contentLoading, setContentLoading] = useState(false);
  const lastLoadedNoteIdRef = useRef(noteId);
  // Between "a new note is being created" and "the pane points at it" the pane
  // still carries the old note's id, so a load or a save response that lands in
  // that window looks legitimate and repaints the old text over the empty pane.
  // Nothing may write content during that window.
  const paneTransitionRef = useRef(false);
  const [paneLocked, setPaneLocked] = useState(false);
  const transitionJustEndedRef = useRef(false);
  // Which note the text in the pane belongs to. A flush (page hide, pane unmount)
  // must never write the pane's text under a different note's id — that is how a
  // switch stored one note's body over another.
  const contentNoteIdRef = useRef(noteId);
  // The content whose save already failed. Without this the autosave effect
  // re-scheduled itself on every render — a failed save changes state, which
  // changes the callback identity, which schedules another save — and a hung
  // server was retried every 500 ms instead of being reported once.
  const failedContentRef = useRef(null);
  const beginPaneTransition = useCallback(() => {
    paneTransitionRef.current = true;
    setPaneLocked(true);
    // A read already in flight for the note being left must not paint on top of
    // the blank pane: its answer arrived before the person pressed "+", and
    // showing it again made the old text reappear for half a second.
    loadRequestRef.current += 1;
  }, []);
  // A switch: the pane's text belongs to the note being left. Clearing the refs
  // here (not in an effect) is what makes the order deterministic — clear, then
  // ask for the next note, so the load that follows cannot be mistaken for text
  // the person typed.
  // Pressing a row: the screen must show the new note or "Loading note…" from the
  // click, not the note being left while its last save drains. The text stays in
  // the refs so the flush that follows can still write it to the right note.
  const hideForSwitch = useCallback(() => {
    paneTransitionRef.current = true;
    setPaneLocked(true);
    setContentLoading(true);
    setContent('');
    // The text still in the refs is the note being left, and it is about to be
    // flushed under that note's id. Anything typed from here on belongs to the
    // next note, so ownership is unknown until the pane learns its id.
    contentNoteIdRef.current = null;
  }, []);

  const clearForSwitch = useCallback(() => {
    paneTransitionRef.current = true;
    setPaneLocked(true);
    setContent('');
    contentRef.current = '';
    lastContentRef.current = '';
    contentEditVersionRef.current += 1;
    loadRequestRef.current += 1;
  }, []);

  const endPaneTransition = useCallback(() => {
    paneTransitionRef.current = false;
    setPaneLocked(false);
  }, []);
  // Ranges an agent wrote in this note; replaced on every load with the server's
  // answer, and remapped locally by the editor as the person types.
  const [agentSpans, setAgentSpans] = useState([]);
  const [saveError, setSaveError] = useState(null);

  const saveStatusRef = useRef('idle');
  const saveTimeoutRef = useRef(null);
  const manualLoadNoteRef = useRef(null);
  const noteIdLoadedRef = useRef(null);
  const loadRequestRef = useRef(0);
  const syncedCanonicalContentRef = useRef(new Map());
  const canonicalRevisionRef = useRef(new Map());
  // The revision each note's *text* came from, which is not the same thing as the
  // newest revision this device has heard of. A save may only claim this one:
  // claiming the newest lets a pane whose text is older write over whatever the
  // newer revision contained — an agent's paragraph, silently (2026-11-18).
  const contentRevisionRef = useRef(new Map());
  // A revision the server refused a save with, kept for the one deliberate act
  // that may claim it: the person choosing "Keep my version" after being told.
  const pendingConflictRevisionRef = useRef(new Map());
  // The text this page committed through a save. Anything else in the store was
  // written by someone else's path — a journal replay, another tab — and carries
  // no claim this page can make.
  const committedContentRef = useRef(new Map());
  const saveQueueRef = useRef(Promise.resolve());
  const queuedContentRef = useRef(null);
  const activeNoteIdRef = useRef(noteId);
  activeNoteIdRef.current = noteId;

  const resolvedRevision =
    typeof resolvedNote?.revision === 'string' && resolvedNote.revision.trim()
      ? resolvedNote.revision.trim()
      : null;
  if (noteId && resolvedRevision && !canonicalRevisionRef.current.has(noteId)) {
    // Loads start in an effect, so seed the known base during render to make it
    // available even when the user edits before the load response arrives.
    canonicalRevisionRef.current.set(noteId, resolvedRevision);
  }

  // The editor opens on a placeholder note. It is a real, savable note as soon
  // as it holds text (the first keystroke materialises it) or as soon as the
  // list already carries a note with that id — otherwise typing into the note
  // the app opens on is never written on a timer, only on the pagehide flush.
  const placeholderHasText = typeof content === 'string' && content.trim().length > 0;
  const hasNote = Boolean(
    user &&
      storage &&
      noteId &&
      (noteId !== PLACEHOLDER_NOTE_ID || resolvedNote || placeholderHasText)
  );

  const getDraftKey = useCallback(
    (targetNoteId = noteId) => draftKeyFor(storage?.scopedKey, targetNoteId),
    [noteId, storage]
  );

  const writeDraft = useCallback(
    async (targetNoteId, draftContent) => {
      const key = getDraftKey(targetNoteId);
      if (!key) return;
      await window.storage.set(
        key,
        serializeDraft({
          noteId: targetNoteId,
          content: draftContent,
          baseRevision: canonicalRevisionRef.current.get(targetNoteId) || null,
        })
      );
    },
    [getDraftKey]
  );

  // The one writer of note content. Every save path in this hook goes through
  // it, so the journal's ordering — content commits, then the record it
  // supersedes is consumed — is decided in one place instead of four.
  const commitContent = useCallback(
    (targetNoteId, contentToSave, { clearDraft = 'conditional' } = {}) =>
      commitNoteContent({
        store: window.storage,
        noteId: targetNoteId,
        noteKey: storage?.noteStorageKey?.(targetNoteId),
        draftKey: getDraftKey(targetNoteId),
        contentToSave,
        clearDraft,
      }),
    [getDraftKey, storage]
  );

  const readDraft = useCallback(
    async (targetNoteId) => {
      const key = getDraftKey(targetNoteId);
      if (!key) return null;
      const stored = await window.storage.get(key);
      if (!stored?.value) return null;
      return parseDraft(stored.value, targetNoteId);
    },
    [getDraftKey]
  );

  const clearDraft = useCallback(
    async (targetNoteId) => {
      const key = getDraftKey(targetNoteId);
      if (key) await window.storage.delete(key);
    },
    [getDraftKey]
  );

  const clearDraftIfContentMatches = useCallback(
    async (targetNoteId, expectedContent) => {
      const draft = await readDraft(targetNoteId);
      if (!draft || draft.content === expectedContent) await clearDraft(targetNoteId);
    },
    [clearDraft, readDraft]
  );

  const clearPendingSave = useCallback(() => {
    if (!saveTimeoutRef.current) return;

    if (typeof saveTimeoutRef.current === 'function') {
      saveTimeoutRef.current();
    } else {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = null;
  }, []);

  // Titles come from the markdown source, so show the words and not the
  // syntax: '# Reliability check' is titled 'Reliability check'.
  const getPreviewTitle = useCallback(
    (contentToSave) => titleFromMarkdown(contentToSave),
    []
  );

  const readCanonicalRevision = useCallback(
    (targetNoteId = noteId) => {
      if (!targetNoteId) return null;
      return canonicalRevisionRef.current.get(targetNoteId) || null;
    },
    [noteId]
  );

  const writeCanonicalRevision = useCallback((targetNoteId, revision) => {
    if (!targetNoteId || typeof revision !== 'string' || !revision.trim()) return null;
    canonicalRevisionRef.current.set(targetNoteId, revision.trim());
    return revision.trim();
  }, []);

  // Every write of the revision a note's *text* came from goes through here, so the
  // question "what did this save claim, and on what grounds?" has one answer.
  // The revision is kept per page in a ref, which a reload forgets — and without it
  // a fresh page cannot tell whose text its store holds, so it refuses to adopt the
  // server's newer text and the person has to press "Use server version" to see a
  // paragraph an agent wrote. Kept beside the text in the store, the next page knows
  // what its copy is and can adopt what is newer.
  // One copy in memory, written through one queue. Read-modify-write per change lost
  // entries whenever two binds were in flight (measured: three binds, an empty map,
  // and a load that then believed its stale text was current).
  const storedRevisionsRef = useRef(null);
  const revisionWriteQueueRef = useRef(Promise.resolve());

  const readStoredRevisions = useCallback(async () => {
    if (storedRevisionsRef.current) return storedRevisionsRef.current;
    const key = storage?.scopedKey?.('note-revisions');
    if (!key) {
      storedRevisionsRef.current = {};
      return storedRevisionsRef.current;
    }
    try {
      const stored = await window.storage.get(key);
      const parsed = stored?.value ? JSON.parse(stored.value) : {};
      storedRevisionsRef.current = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      storedRevisionsRef.current = {};
    }
    return storedRevisionsRef.current;
  }, [storage]);

  const writeStoredRevision = useCallback(
    (targetNoteId, revision) => {
      const key = storage?.scopedKey?.('note-revisions');
      if (!key || !targetNoteId) return;
      revisionWriteQueueRef.current = revisionWriteQueueRef.current.then(async () => {
        try {
          const map = await readStoredRevisions();
          if (revision) map[targetNoteId] = revision;
          else delete map[targetNoteId];
          await window.storage.set(key, JSON.stringify(map));
        } catch {
          // A hint that cannot be written costs a conflict, never a silent write.
        }
      });
    },
    [readStoredRevisions, storage]
  );

  const bindContentRevision = useCallback(
    (targetNoteId, revision, source) => {
      if (!targetNoteId) return null;
      const value = typeof revision === 'string' && revision.trim() ? revision.trim() : null;
      contentRevisionRef.current.set(targetNoteId, value);
      writeStoredRevision(targetNoteId, value);
      logSaveDebug('content-revision', { noteId: targetNoteId, revision: value, source });
      return value;
    },
    [writeStoredRevision]
  );

  const runContentLoad = useCallback(
    async (
      targetNoteId,
      { shouldFocus = false, allowLocalFallback = true, discardDraft = false } = {}
    ) => {
      if (!user || !storage || !targetNoteId) return null;
      // Asking for a note's text means the pane is pointing at it, so the window
      // in which a new note was being created is over from here on. Text typed in
      // that window is the new note's first words: capture it before the clear
      // below (and before anything repaints), because it has no note id yet.
      const typedDuringTransition =
        paneTransitionRef.current && contentRef.current.trim() !== '';
      const liveTypedText = contentRef.current;
      if (paneTransitionRef.current) transitionJustEndedRef.current = true;
      paneTransitionRef.current = false;
      setPaneLocked(false);
      // A load is the one place that knows it is about to show a different note.
      // Clearing here, before the fetch, is what keeps the pane from showing the
      // note it left — and doing it here rather than in an effect means it cannot
      // run after the load has already painted.
      if (
        lastLoadedNoteIdRef.current &&
        lastLoadedNoteIdRef.current !== targetNoteId &&
        lastLoadedNoteIdRef.current !== PLACEHOLDER_NOTE_ID &&
        targetNoteId !== PLACEHOLDER_NOTE_ID &&
        !typedDuringTransition
      ) {
        setContent('');
        contentRef.current = '';
        lastContentRef.current = '';
        contentNoteIdRef.current = null;
        contentEditVersionRef.current += 1;
      }
      lastLoadedNoteIdRef.current = targetNoteId;
      const requestId = ++loadRequestRef.current;
      // The pane is about to show a note it does not have the text of yet, so
      // say that instead of rendering an empty editor.
      if (targetNoteId === activeNoteIdRef.current) setContentLoading(true);
      // Markdown state is the single representation and contentRef updates on
      // every keystroke, so it is always the live text.
      const contentAtRequestStart = contentRef.current;
      const editVersionAtRequestStart = contentEditVersionRef.current;
      const revisionAtRequestStart = canonicalRevisionRef.current.get(targetNoteId) || null;
      // What this device last saw, read before the fetch writes the new one.
      const storedRevisionAtRequestStart = Number(readCanonicalRevision(targetNoteId));
      // What revision the text in this device's store came from, if the last page
      // managed to record it. This page's memory alone forgets on reload.
      const persistedRevisions = await readStoredRevisions();
      const storedTextRevision =
        canonicalRevisionRef.current.get(targetNoteId) || persistedRevisions[targetNoteId] || null;
      const storedTextRevisionNumber = Number(storedTextRevision);
      try {
        // Local-only mode: the note lives in browser storage; there is no API
        // to ask and no revision to reconcile against.
        let remoteNote;
        if (isSupabaseConfigured()) {
          remoteNote = normalizeApiNote(await notesApi.get(targetNoteId));
        } else {
          const localKey = storage.noteStorageKey(targetNoteId);
          const stored = localKey ? await window.storage.get(localKey) : null;
          remoteNote = { id: targetNoteId, content: stored?.value || '', revision: null };
        }
        const nextContent = remoteNote?.content || '';
        if (targetNoteId === activeNoteIdRef.current) {
          setAgentSpans(Array.isArray(remoteNote?.agentSpans) ? remoteNote.agentSpans : []);
        }
        if (requestId !== loadRequestRef.current) {
          return null;
        }
        syncedCanonicalContentRef.current.set(targetNoteId, nextContent);
        const liveLocalContent = contentRef.current;
        // "The text changed while this read was in flight" is only evidence of an
        // edit when the pane actually holds text the store does not. A pane that is
        // being switched to this note changes too — it is cleared, or still holds
        // the note before it — and treating that as newer text wrote the pane's
        // empty content over the note's stored text: in the folder store, under
        // load, the `.md` file was emptied and the row then opened blank. So a
        // draft counts as the pane's newer text only when the pane holds something
        // the store does not (`contentRef` differs from the last committed text).
        const paneHoldsUncommittedText = liveLocalContent !== lastContentRef.current;
        const changedDuringLoad =
          !discardDraft &&
          // `noteId` is captured by the render that started this load, so comparing
          // against it is a tautology. The pane's live note is the only meaningful
          // test: text belongs to whatever note is on screen now.
          targetNoteId === activeNoteIdRef.current &&
          paneHoldsUncommittedText &&
          (contentEditVersionRef.current !== editVersionAtRequestStart ||
            liveLocalContent !== contentAtRequestStart);
        // The persisted record is a *conflict* draft: it exists to be compared
        // against a revision. The local notebook has no revisions at all, so a
        // record found here can only be older than content the store already
        // holds — a leftover from a save that committed after the record was
        // written. Preferring it reverted the editor to the previous text while
        // the store held the new one (the row said "Draft two", the editor
        // showed "Draft one"). Restoring an uncommitted draft is the journal
        // replay's job on open, where the record's own timestamp decides.
        const persistedDraft =
          discardDraft || !remoteNote?.revision ? null : await readDraft(targetNoteId);
        const localDraft = changedDuringLoad
          ? {
              noteId: targetNoteId,
              content: liveLocalContent,
              baseRevision: revisionAtRequestStart,
            }
          : persistedDraft;
        if (requestId !== loadRequestRef.current) return null;
        const draftMatchesRemote = localDraft?.content === nextContent;
        const draftCanRebase =
          localDraft &&
          (localDraft.baseRevision === remoteNote?.revision ||
            draftMatchesRemote ||
            (changedDuringLoad && nextContent === contentAtRequestStart));
        // Text typed after this read started is the pane's, not the server's. A
        // load that answers with a prefix of what the pane already holds is a
        // slow answer to a note that is still being typed into — and the place
        // the head of a sentence disappeared: a new note is created from the
        // placeholder while the person is already writing, the create carries the
        // first seconds of text, and the load for the new id then replaced the
        // pane with that shorter version. Nothing the person typed is deleted by
        // a load.
        const paneContent = contentRef.current;
        // "The pane holds more than the server" is only evidence of typing when
        // the server's text is real: an empty answer is a prefix of everything, and
        // that made a brand-new empty note adopt the previous note's text — the
        // first save then duplicated it into the new row.
        // The pane is ahead when it holds text the store does not. A note whose
        // stored text is empty and whose pane already has words is exactly that
        // case — without it, the load of a note someone typed into while it was
        // being created repainted the pane empty and the words were never saved.
        const paneOwnsItsText =
          !contentNoteIdRef.current || contentNoteIdRef.current === targetNoteId;
        const paneIsAhead =
          paneOwnsItsText &&
          typeof paneContent === 'string' &&
          paneContent.length > 0 &&
          (nextContent.length === 0
            ? true
            : paneContent.length > nextContent.length && paneContent.startsWith(nextContent));
        // Never replace text entered while this request was in flight. If it cannot
        // be rebased safely, keep it visible and block writes with a conflict.
        // The server is the arbiter of what the note is: if its revision is ahead
        // of the one this device last saw, the stored text is behind and the pane
        // must show the server's. Without this, a reload kept the local copy and
        // an agent's paragraph never appeared — the local-first read won every
        // time, so "you see it on reload" was false for anyone who had the note
        // open before. Text typed during this read still wins (above).
        const remoteIsNewer =
          Number.isFinite(storedTextRevisionNumber) &&
          Number.isFinite(Number(remoteNote?.revision)) &&
          Number(remoteNote.revision) > storedTextRevisionNumber;

        const displayedContent = typedDuringTransition
          ? liveTypedText
          : paneIsAhead
            ? paneContent
          : remoteIsNewer
            ? nextContent
            : localDraft && (draftCanRebase || changedDuringLoad) && !draftMatchesRemote
              ? localDraft.content
              : nextContent;

        // The revision belongs to the text it arrived with. Adopting the server's
        // revision while the pane keeps an older text is what let a stale copy save
        // over an agent's paragraph with a fresh revision and no conflict at all:
        // measured on 2026-11-18, the agent wrote revision 2, the reopened tab still
        // showed revision 1's text, and the next save went 2 → 3 with the paragraph
        // gone and nothing said. A revision is a claim about content; only make it
        // when this is the content.
        if (remoteNote?.revision && displayedContent === nextContent) {
          writeCanonicalRevision(targetNoteId, remoteNote.revision);
        }
        bindContentRevision(
          targetNoteId,
          displayedContent === nextContent ? remoteNote?.revision || null : revisionAtRequestStart,
          displayedContent === nextContent ? 'load-adopted-server-text' : 'load-kept-other-text'
        );
        const noteKey = storage.noteStorageKey(targetNoteId);
        // Writing back the text this load read is only safe while the store still
        // holds it. The read above and the write below are separate operations and
        // nothing re-checks the store in between, so a save that lands while the
        // read is in flight is newer than the text about to be written — and the
        // write then puts the older, shorter text back. Measured under parallel
        // load in the folder store: the `.md` file came back a character or two
        // short although it provably held the full text when the reload started.
        // The re-read applies only when the text being written is exactly the text
        // that was read: a pane edit that shortens a note is legitimate and must
        // still be written, and a discard is a decision the user made.
        const writesBackWhatItRead =
          Boolean(noteKey) && displayedContent === nextContent && !discardDraft;
        const storedNow = writesBackWhatItRead
          ? (await window.storage.get(noteKey))?.value ?? null
          : null;
        const storeMovedOn =
          writesBackWhatItRead && typeof storedNow === 'string' && storedNow !== nextContent;
        if (noteKey && !storeMovedOn) {
          // The load writes its content through the one save path: the journal
          // record is consumed by the content it was holding, or by an adoption
          // that supersedes it outright.
          await commitContent(targetNoteId, displayedContent, {
            clearDraft: discardDraft ? 'always' : 'conditional',
          });
        }
        if (requestId !== loadRequestRef.current) {
          // A superseded load may still carry text the store does not have — the
          // user typed while this read was in flight — so it is written back. It
          // must not write the pane's text when the pane holds nothing for this
          // note: a pane is blank before it has loaded the note (a switch, or the
          // placeholder the app opened on), and committing that blanked a note the
          // user had — in the folder store the note's own `.md` file came back
          // empty, and the row then opened blank (caught under load, where the
          // boot read and the click's read overlap).
          const liveTextIsNewer =
            contentRef.current !== lastContentRef.current &&
            !(contentRef.current === '' && nextContent !== '');
          if (noteKey && liveTextIsNewer && contentRef.current !== displayedContent) {
            await commitContent(targetNoteId, contentRef.current, { clearDraft: 'never' });
          }
          return null;
        }
        if (storeMovedOn) {
          // The store holds text this read did not return. Two very different
          // situations hide behind that, and the revision decides which one it is:
          //
          //  - a save landed while the read was in flight (same revision): the store
          //    is ahead, the pane adopts it and writes nothing;
          //  - the server moved on and this device never saw it (server revision
          //    ahead of the last one read here): the store is *behind*, and adopting
          //    it is how an agent's paragraph failed to appear on reload — the pane
          //    kept yesterday's text and the next save deleted the paragraph with a
          //    revision that looked current. Here the server's text wins.
          // Text in the store that this page did not write, with no journal draft to
          // account for it, is text of unknown age: a replay put it back, or another
          // tab left it. Keeping it is what made a reopened note show yesterday's
          // copy while an agent's paragraph sat on the server. The server's text is
          // the one version that is certainly current.
          // Only when the store *claims* the server's revision and still is not what
          // this page wrote: then the claim and the text disagree, and the text is
          // what is wrong. A store with no recorded revision is simply older, and
          // keeping it is the safe answer (a save that landed during the read).
          const recordedTextRevision = persistedRevisions[targetNoteId] ?? null;
          const storeClaimsCurrentRevision =
            recordedTextRevision !== null &&
            Number(recordedTextRevision) >= Number(remoteNote?.revision ?? -1);
          const strangerText =
            storeClaimsCurrentRevision &&
            committedContentRef.current.get(targetNoteId) !== storedNow &&
            !persistedDraft;
          const adoptServerText = remoteIsNewer || strangerText;
          const adoptedContent = adoptServerText ? nextContent : storedNow;
          if (adoptServerText && remoteNote?.revision) {
            writeCanonicalRevision(targetNoteId, remoteNote.revision);
          }
          // A store this page did not write is text of unknown provenance: it may
          // be a draft a replay put back, whose revision is older than the one this
          // device remembers. Claiming the remembered revision then deletes what the
          // newer one held — the clobber, exactly. So the claim survives only when
          // the store's text is this page's own last commit.
          const storeIsOwnCommit = committedContentRef.current.get(targetNoteId) === storedNow;
          bindContentRevision(
            targetNoteId,
            adoptServerText
              ? remoteNote?.revision || null
              : storeIsOwnCommit
                ? revisionAtRequestStart
                : null,
            adoptServerText
              ? 'store-behind-server'
              : storeIsOwnCommit
                ? 'store-moved-on'
                : 'store-holds-foreign-text'
          );
          // The server's text is committed to the store too: otherwise every open
          // meets the same divergence and re-decides it.
          if (adoptServerText && noteKey) {
            await commitContent(targetNoteId, adoptedContent, { clearDraft: 'never' });
          }
          syncedCanonicalContentRef.current.set(targetNoteId, adoptedContent);
          lastContentRef.current = adoptedContent;
          contentRef.current = adoptedContent;
          setContent(adoptedContent);
          logSaveDebug(
            adoptServerText ? 'note-load-server-ahead-of-store' : 'note-load-store-moved-on',
            {
              paneId,
              noteId: targetNoteId,
              readLength: nextContent.length,
              storedLength: storedNow.length,
            }
          );
          return adoptedContent;
        }
        if (changedDuringLoad) await writeDraft(targetNoteId, displayedContent);
        // The live text can move after the guard above: the store read, the
        // draft read and the commit all await, and an IndexedDB round trip is a
        // real one. A load that lands on top of a keystroke is note loss, not a
        // stale screen — and the guard above only catches a change made *during*
        // the read, not text that was already newer than the store when the read
        // started (the save debounce is 1.5 s behind the keystroke). So the
        // question asked immediately before the write is the honest one: does
        // the store hold what the editor is showing? If not, the editor wins,
        // and the pending save (or the next load) adopts it.
        const liveContentNow = contentRef.current;
        if (
          !discardDraft &&
          // The only thing that supersedes a load is text the person typed while
          // it was in flight — and that has a version. Comparing the pane against
          // the store is not evidence: a switched pane holds '' by design, and
          // treating that as "ahead" left the note blank on screen forever.
          contentEditVersionRef.current !== editVersionAtRequestStart &&
          // `noteId` is captured by the render that started this load, so comparing
          // against it is a tautology. The pane's live note is the only meaningful
          // test: text belongs to whatever note is on screen now.
          targetNoteId === activeNoteIdRef.current &&
          (liveContentNow !== liveLocalContent || liveContentNow !== lastContentRef.current)
        ) {
          logSaveDebug('note-load-superseded', {
            paneId,
            noteId: targetNoteId,
            contentLength: liveContentNow.length,
            loadedLength: displayedContent.length,
          });
          setContentLoading(false);
          return liveContentNow;
        }
        setContentLoading(false);
        setContent(displayedContent);
        contentRef.current = displayedContent;
        lastContentRef.current = nextContent;
        contentNoteIdRef.current = targetNoteId;
        // The textarea value follows the `content` state above; only move focus.
        if (shouldFocus && editorRef.current) {
          setTimeout(() => {
            if (requestId === loadRequestRef.current && editorRef.current) {
              editorRef.current.focus?.();
              editorRef.current.setSelection?.(displayedContent.length);
            }
          }, 50);
        }
        logSaveDebug('note-load', {
          paneId,
          noteId: targetNoteId,
          contentLength: nextContent.length,
          hadContent: nextContent.length > 0,
        });
        if (localDraft && !draftCanRebase) {
          applyConflictSnapshot('conflicted', {
            noteId: targetNoteId,
            storageKey: storage.noteStorageKey(targetNoteId),
            localContent: localDraft.content,
            incomingContent: nextContent,
            savedContent: contentAtRequestStart,
            detectedAt: new Date().toISOString(),
          });
        }
        return displayedContent;
      } catch (error) {
        if (requestId === loadRequestRef.current) {
          setContentLoading(false);
          console.error('Failed to load note content:', error);
        }
        if (!allowLocalFallback) return null;
        const savedContent = await window.storage.get(storage.noteStorageKey(targetNoteId));
        const fallbackContent = typeof savedContent?.value === 'string' ? savedContent.value : null;
        if (fallbackContent != null && requestId === loadRequestRef.current) {
          if (contentRef.current !== lastContentRef.current) {
            // Same rule as the main path: a load never lands on top of text the
            // store does not hold yet.
            return contentRef.current;
          }
          setContent(fallbackContent);
          contentRef.current = fallbackContent;
          lastContentRef.current = fallbackContent;
          if (shouldFocus && editorRef.current) {
            setTimeout(() => {
              if (requestId === loadRequestRef.current && editorRef.current) {
                editorRef.current.focus?.();
                editorRef.current.setSelection?.(fallbackContent.length);
              }
            }, 50);
          }
        }
        return fallbackContent;
      }
    },
    [
      commitContent,
      applyConflictSnapshot,
      contentRef,
      contentEditVersionRef,
      editorRef,
      lastContentRef,
      noteId,
      paneId,
      readDraft,
      setContent,
      storage,
      user,
      writeCanonicalRevision,
      writeDraft,
    ]
  );

  useEffect(() => {
    if (!hasNote) {
      clearPendingSave();
      if (!noteId || noteId === PLACEHOLDER_NOTE_ID) {
        // Genuinely no note selected — clear everything and reset load tracking.
        noteIdLoadedRef.current = null;
        clearConflictRecovery();
        setContent('');
        contentRef.current = '';
        lastContentRef.current = '';
        saveStatusRef.current = 'idle';
        setSaveStatus('idle');
        setSaveError(null);
        if (editorRef.current) {
          editorRef.current.setValue?.('');
        }
      }
      // Else: user is transiently null (auth refresh) — don't clear editor or conflict
      // state; that would restart autosave with a stale revision and cause a 409 loop.
      return;
    }

    let cancelled = false;

    // The placeholder is not a note yet: text typed before it materialises lives
    // only in this pane, and nothing has been loaded or saved here yet, so there
    // is no stored content to load over it. Adopt the live text instead.
    if (
      noteId === PLACEHOLDER_NOTE_ID &&
      lastContentRef.current === '' &&
      contentRef.current.trim() !== ''
    ) {
      noteIdLoadedRef.current = noteId;
      lastContentRef.current = '';
      return () => {
        cancelled = true;
      };
    }

    if (manualLoadNoteRef.current === noteId) {
      return () => {
        cancelled = true;
      };
    }

    // A pane belongs to one note at a time. When it is pointed at a different one,
    // the previous note's text must leave before anything else happens: leaving it
    // there meant a keystroke landed in the wrong note, and the "already loaded"
    // skip below could then swallow the switch entirely, so the pane lost the old
    // text from its bookkeeping without ever fetching the new one. This runs on
    // every switch, including switching back to a note loaded earlier in the
    // session. The placeholder becoming a real note is the one case that is not a
    // switch — that is the same text being adopted.
    if (paneTransitionRef.current) transitionJustEndedRef.current = true;
    paneTransitionRef.current = false;
    setPaneLocked(false);

    // Skip if this noteId was already loaded — prevents auth-refresh events from
    // firing duplicate runContentLoad calls for the same note.
    if (noteIdLoadedRef.current === noteId) {
      return () => {
        cancelled = true;
      };
    }

    if (conflictSnapshotRef.current && conflictSnapshotRef.current.noteId !== noteId) {
      clearConflictRecovery();
    }

    noteIdLoadedRef.current = noteId;
    const restoreConflictForNote = async () => {
      const loadedContent = await runContentLoad(noteId);
      if (loadedContent === null && !cancelled) {
        // Both API and localStorage failed — reset so next trigger can retry.
        noteIdLoadedRef.current = null;
      }
      if (cancelled) return;
      const persistedConflict = await readPersistedConflictSnapshot(noteId);
      if (cancelled || !persistedConflict) {
        return;
      }
      const snapshot = {
        ...persistedConflict,
        incomingContent:
          typeof loadedContent === 'string' ? loadedContent : persistedConflict.incomingContent,
      };
      if (cancelled) return;
      // If the draft matches the server content the conflict is already resolved — clear it.
      if (snapshot.localContent === snapshot.incomingContent) {
        await clearPersistedConflictSnapshot(noteId);
        return;
      }
      applyConflictSnapshot('conflicted', snapshot);
      logSaveDebug('conflict-restored-from-storage', {
        paneId,
        noteId,
        localLength: snapshot.localContent?.length || 0,
        incomingLength: snapshot.incomingContent?.length || 0,
      });
      saveStatusRef.current = 'conflict';
      setSaveStatus('conflict');
      setSaveError(conflictMessage);
    };
    void restoreConflictForNote();
    return () => {
      cancelled = true;
    };
  }, [
    clearConflictRecovery,
    clearPendingSave,
    conflictMessage,
    conflictSnapshotRef,
    contentRef,
    editorRef,
    hasNote,
    lastContentRef,
    noteId,
    paneId,
    readPersistedConflictSnapshot,
    runContentLoad,
    applyConflictSnapshot,
    setContent,
  ]);

  useEffect(() => {
    if (!noteId) return;
    if (!resolvedRevision) return;
    const existing = canonicalRevisionRef.current.get(noteId) || null;
    if (!existing) {
      // Seed from the notes list on first load.
      canonicalRevisionRef.current.set(noteId, resolvedRevision);
      return;
    }
    // Never advance an open editor's revision from list metadata alone. Content and
    // revision must be adopted together from the same canonical response.
  }, [noteId, resolvedRevision]);

  // (The switch itself is cleared in the load effect above: the pane's text must
  // leave before anything else, and that is the one place that knows the order.)

  const getLatestContentForPersistence = useCallback(() => {
    // While the pane is being pointed at a new note the textarea is blank and
    // locked. The outgoing text still has to be saved, so during that window the
    // refs — not the screen — are the truth.
    if (!paneTransitionRef.current) {
      const editor = editorRef.current;
      if (editor && typeof editor.getValue === 'function') {
        return editor.getValue();
      }
    }
    return contentRef.current;
  }, [contentRef, editorRef]);

  const flushLocalSnapshot = useCallback(
    async ({ fireAndForget = false, reason = 'pagehide' } = {}) => {
      if (!user || !storage || !noteId || hasConflictRef.current) return false;
      if (isNoteDeleted(noteId)) return false;
      // The pane's text belongs to the note it was loaded for. After a switch it
      // may still be showing the previous note for a moment, and a flush in that
      // moment wrote that note's body into this one.
      if (contentNoteIdRef.current && contentNoteIdRef.current !== noteId) return false;

      const noteKey = storage?.noteStorageKey?.(noteId);
      if (!noteKey) return false;

      const contentToSave = getLatestContentForPersistence();
      const draftKey = getDraftKey(noteId);

      // The flush exists to protect text the store does not hold yet, and it used
      // to commit whatever the pane was showing for whatever note was current,
      // without asking. A pane that has not loaded the note it names is blank —
      // the placeholder the app opened on, or a note whose load is still in flight
      // — so the folder store wrote an empty `untitled.md` per blank placeholder
      // and 0 bytes over a note the user had (measured under load: three empty
      // files beside the user's note, which then opened blank). Both rules below
      // are the journal record's own rule, applied to the content write too:
      // only text the store does not hold, and never a blank pane over a note
      // whose stored text is not blank. A deletion the user just made is still
      // saved by the debounced save path while the tab is alive; the unload flush
      // is the backstop for typing, not for erasing.
      const paneHoldsUncommittedText = lastContentRef.current !== contentToSave;
      const blankPaneOverStoredText = contentToSave === '' && lastContentRef.current !== '';
      const shouldCommit = paneHoldsUncommittedText && !blankPaneOverStoredText;

      // An unload cannot wait for an asynchronous store, and an IndexedDB
      // transaction started here is usually aborted by the navigation — so the
      // draft that a reload is supposed to protect would be lost, which it was
      // not while the notebook was on Web Storage (that write is synchronous).
      // Web Storage is the one store that accepts a write during unload, so the
      // journal record goes there, in the notebook's own key space: the next
      // open moves it into the store with the rest of the migration and the
      // replay restores the text from it. Only when something is actually
      // uncommitted — a record for text the store already holds is noise.
      if (fireAndForget && draftKey && shouldCommit) {
        writeBrowserStorageValue(
          draftKey,
          serializeDraft({
            noteId,
            content: contentToSave,
            baseRevision: canonicalRevisionRef.current.get(noteId) || null,
          })
        );
      }

      // Write-ahead: the journal record goes first, then the content it holds, so
      // a tab that dies between the two leaves the text where the next open
      // replays it. The record is consumed by the content that matches it.
      const writeLocalDraft = (async () => {
        if (!shouldCommit) return;
        await writeDraft(noteId, contentToSave);
        await commitContent(noteId, contentToSave);
      })();

      if (fireAndForget) {
        void writeLocalDraft.catch((error) => {
          console.error('Failed to flush local note snapshot:', error);
        });
        logSaveDebug('local-flush', {
          paneId,
          noteId,
          reason,
          fireAndForget: true,
          contentLength: contentToSave.length,
        });
        return true;
      }

      await writeLocalDraft;
      logSaveDebug('local-flush', {
        paneId,
        noteId,
        reason,
        fireAndForget: false,
        contentLength: contentToSave.length,
      });
      return true;
    },
    [
      clearPendingSave,
      commitContent,
      getLatestContentForPersistence,
      hasConflictRef,
      lastContentRef,
      noteId,
      paneId,
      storage,
      user,
      writeDraft,
    ]
  );

  const markContentSaved = useCallback(
    (contentToSave, updatedTimestamp = Date.now()) => {
      lastContentRef.current = contentToSave;
      setSaveError(null);

      requestAnimationFrame(() => {
        saveStatusRef.current = 'saved';
        setSaveStatus('saved');
        setTimeout(() => {
          if (saveStatusRef.current === 'saved') {
            saveStatusRef.current = 'idle';
            setSaveStatus('idle');
          }
        }, 2000);
      });

      requestAnimationFrame(() => {
        const preview = getPreviewTitle(contentToSave);
        if (preview && notes?.updateNoteInList) {
          // The row's second line comes from the same content, so the list stays
          // current with what is in the editor without re-reading the note.
          notes.updateNoteInList(noteId, preview, updatedTimestamp, {
            preview: previewFromMarkdown(contentToSave),
          });
        }
      });

      // Snapshot for the history panel. Best effort: a failure here must never
      // affect the save the user just performed.
      void recordNoteVersion(storage, noteId, contentToSave).catch((error) => {
        console.warn('Failed to record note version:', error);
      });
    },
    [getPreviewTitle, lastContentRef, noteId, notes, storage]
  );

  const clearFailedContentMarker = useCallback(() => {
    failedContentRef.current = null;
  }, []);

  const handleSaveFailure = useCallback((error) => {
    console.error('Failed to save note:', error);
    // One sentence per failure class, decided in the storage layer: a browser
    // that blocks storage will refuse every retry, so "please retry" there is
    // the wrong instruction and the user loses the note believing it was saved.
    // A failed request has a status and a sentence already decided by
    // save-outcome; a failed storage write has its own sentence. Both must reach
    // the footer at once — the rAF wrapper meant a timeout could leave the footer
    // on "Saving…" for as long as the tab was not animating.
    const message =
      error?.name === 'NotesApiError'
        ? describeSaveOutcome({
            status: Number(error.status) || 0,
            message: error.message,
            online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
          }).message
        : describeStorageFailure(error);
    saveStatusRef.current = 'error';
    setSaveStatus('error');
    setSaveError(message);
  }, []);

  const performContentSave = useCallback(
    async (
      contentToSave,
      {
        force = false,
        preserveConflictRecovery = false,
        syncReason = 'autosave',
        _safeRebaseRetry = false,
      } = {}
    ) => {
      if (!hasNote) return false;
      // The note was deleted while this save was queued: writing it now would
      // bring the note back on the next page load.
      if (isNoteDeleted(noteId)) return false;
      // Text known to belong to a different note is never written here. Unknown
      // (`null`) is allowed: that is text typed before the pane learned its id,
      // which is exactly what the switch must save.
      if (contentNoteIdRef.current && contentNoteIdRef.current !== noteId) return false;
      if (hasConflictRef.current && conflictSnapshotRef.current?.noteId === noteId && !force) {
        saveStatusRef.current = 'conflict';
        setSaveStatus('conflict');
        setSaveError(conflictMessage);
        return false;
      }
      const noteKey = storage.noteStorageKey(noteId);
      if (!noteKey) return false;

      try {
        // A save supersedes any older load response for this pane.
        loadRequestRef.current += 1;
        const updatedTimestamp = Date.now();
        await commitContent(noteId, contentToSave);
        const preview = getPreviewTitle(contentToSave) || 'Untitled';
        let savedData = null;
        if (isSupabaseConfigured()) {
        // The record stays behind while the server answers: if the server
        // refuses this text, the version it did not take must still be
        // somewhere the next open can find it.
        await writeDraft(noteId, contentToSave);
        try {
          // The placeholder is not a note: it is the empty pane a signed-in person
          // sees before their first note exists. Nothing ever created that row, so
          // every save of a first note answered 404 and the text died with the
          // cache. The first content creates the note and the pane adopts its id.
          if (noteId === PLACEHOLDER_NOTE_ID) {
            const newId = createNoteId();
            savedData = await notesApi.create({
              noteId: newId,
              title: preview,
              content: contentToSave,
            });
            if (savedData?.note_id || savedData?.id) {
              const adoptedId = savedData.note_id || savedData.id;
              await commitContent(adoptedId, contentToSave, { clearDraft: 'never' });
              if (savedData.revision) {
                writeCanonicalRevision(adoptedId, savedData.revision);
                bindContentRevision(adoptedId, savedData.revision, 'note-created');
              }
              // Adopt the id only while this pane is still the placeholder. If the
              // person pressed "new note" while this create was in flight, the pane
              // belongs to the newer note now — stealing it back here would show one
              // note and save another.
              if (activeNoteIdRef.current === PLACEHOLDER_NOTE_ID && notes?.switchNote) {
                await notes.switchNote(adoptedId);
              }
              notes?.updateNoteInList?.(adoptedId, preview, Date.now(), {
                revision: savedData.revision ?? null,
              });
              broadcastNotesChanged({ noteId: adoptedId, action: 'create' });
              syncedCanonicalContentRef.current.set(adoptedId, contentToSave);
              await clearDraftIfContentMatches(noteId, contentToSave);
              if (activeNoteIdRef.current === noteId) {
                saveStatusRef.current = 'saved';
                setSaveStatus('saved');
              }
              return true;
            }
          }
          savedData = await notesApi.update(noteId, {
            title: preview,
            content: contentToSave,
            // The revision the text on screen came from, never the newest this
            // device has heard of. If those differ, the save must fail loudly: the
            // newer revision is someone else's words.
            ifRevision: force
              ? pendingConflictRevisionRef.current.get(noteId) ??
                contentRevisionRef.current.get(noteId) ??
                null
              : contentRevisionRef.current.get(noteId) ?? null,
          });
        } catch (error) {
          if (!(error instanceof NotesApiError)) throw error;
          const payload = error.data || {};

          if (error.status === 409 || error.status === 428) {
            const remoteNote = normalizeApiNote(payload?.data);
            if (remoteNote?.content === contentToSave && remoteNote?.revision) {
              writeCanonicalRevision(noteId, remoteNote.revision);
              bindContentRevision(noteId, remoteNote.revision, 'conflict-both-same');
              await clearDraftIfContentMatches(noteId, contentToSave);
              await clearPersistedConflictSnapshot(noteId);
              syncedCanonicalContentRef.current.set(noteId, contentToSave);
              if (activeNoteIdRef.current === noteId) {
                markContentSaved(contentToSave, remoteNote.updated || updatedTimestamp);
                clearConflictRecovery();
              }
              return true;
            }
            const baseContent = syncedCanonicalContentRef.current.get(noteId);
            if (
              !_safeRebaseRetry &&
              remoteNote?.revision &&
              typeof baseContent === 'string' &&
              remoteNote.content === baseContent
            ) {
              writeCanonicalRevision(noteId, remoteNote.revision);
              return performContentSave(contentToSave, {
                force,
                preserveConflictRecovery,
                syncReason,
                _safeRebaseRetry: true,
              });
            }
            if (remoteNote?.revision || payload?.currentRevision) {
              writeCanonicalRevision(noteId, remoteNote?.revision || payload.currentRevision);
              // Kept, not adopted: only "Keep my version" may claim it.
              pendingConflictRevisionRef.current.set(
                noteId,
                remoteNote?.revision || payload.currentRevision
              );
            }
            if (activeNoteIdRef.current !== noteId) return false;
            setConflictRecovery('conflicted', remoteNote?.content || '');
            saveStatusRef.current = 'conflict';
            setSaveStatus('conflict');
            setSaveError(
              payload?.error || describeSaveOutcome({ status: error.status }).message
            );
            logSaveDebug(
              error.status === 428 ? 'supabase-save-precondition' : 'supabase-save-conflict',
              {
                paneId,
                noteId,
                syncReason,
                currentRevision: payload?.currentRevision || null,
              }
            );
            return false;
          }

          if (error.status === 404) {
            // One table decides this, in src/services/save-outcome.js: a note that
            // is gone stays gone, and the draft is kept rather than resurrected.
            const outcome = describeSaveOutcome({ status: 404 });
            saveStatusRef.current = 'error';
            setSaveStatus('error');
            setSaveError(outcome.message);
            logSaveDebug('canonical-note-missing', { paneId, noteId, syncReason });
            return false;
          }

          throw error;
        }
        }

        // In local-only mode there is no server row: synthesize the saved note
        // so the title/list update and the saved status still happen.
        const savedNote = savedData
          ? normalizeApiNote(savedData)
          : {
              id: noteId,
              title: preview,
              content: contentToSave,
              updated: updatedTimestamp,
              revision: null,
              isPinned: false,
            };
        if (savedNote?.revision) {
          writeCanonicalRevision(noteId, savedNote.revision);
          bindContentRevision(noteId, savedNote.revision, 'save-committed');
          committedContentRef.current.set(noteId, contentToSave);
          pendingConflictRevisionRef.current.delete(noteId);
        }
        await clearPersistedConflictSnapshot(noteId);
        await clearDraftIfContentMatches(noteId, contentToSave);
        if (activeNoteIdRef.current === noteId) {
          markContentSaved(contentToSave, savedNote?.updated || updatedTimestamp);
        }
        if (savedNote && notes?.updateNoteInList) {
          notes.updateNoteInList(noteId, savedNote.title, savedNote.updated, {
            revision: savedNote.revision,
            isPinned: savedNote.isPinned,
            folder: savedNote.folder,
            createdBy: savedNote.createdBy,
            createdByName: savedNote.createdByName,
          });
        }
        syncedCanonicalContentRef.current.set(noteId, contentToSave);
        broadcastNotesChanged({ noteId, action: 'update' });
        logSaveDebug('local-save-commit', {
          paneId,
          noteId,
          syncReason,
          contentLength: contentToSave.length,
          forced: force,
        });
        if (!preserveConflictRecovery && activeNoteIdRef.current === noteId) {
          clearConflictRecovery();
        }
        return true;
      } catch (error) {
        // Remember which text failed here, not after the promise resolves: the
        // failure repaints the footer, and the autosave effect watching `content`
        // would set "Saving…" again on that render if the marker were still unset.
        failedContentRef.current = contentToSave;
        if (activeNoteIdRef.current === noteId) handleSaveFailure(error);
        logSaveDebug('local-save-error', {
          paneId,
          noteId,
          syncReason,
          detail: error?.message || 'save-failed',
        });
        return false;
      }
    },
    [
      clearConflictRecovery,
      clearDraftIfContentMatches,
      clearPersistedConflictSnapshot,
      commitContent,
      contentRef,
      conflictMessage,
      conflictSnapshotRef,
      getPreviewTitle,
      handleSaveFailure,
      hasConflictRef,
      hasNote,
      markContentSaved,
      noteId,
      paneId,
      readCanonicalRevision,
      setConflictRecovery,
      storage,
      writeCanonicalRevision,
      writeDraft,
      notes,
    ]
  );

  const persistContentNow = useCallback(
    (contentToSave, options = {}) => {
      const queueKey = `${noteId}\u0000${contentToSave}`;
      if (queuedContentRef.current === queueKey) return saveQueueRef.current;
      queuedContentRef.current = queueKey;
      const queued = saveQueueRef.current
        .catch(() => false)
        .then(() => performContentSave(contentToSave, options))
        .finally(() => {
          if (queuedContentRef.current === queueKey) queuedContentRef.current = null;
        });
      saveQueueRef.current = queued;
      return queued;
    },
    [noteId, performContentSave]
  );

  // Text typed during a switch is real, and nothing was allowed to save it while
  // the window was open. The moment the pane points at its own note, flush it —
  // otherwise the keystrokes live only in the screen and die on reload. It fires
  // once per transition, so normal typing keeps its debounce.
  useEffect(() => {
    if (paneLocked || !transitionJustEndedRef.current) return;
    transitionJustEndedRef.current = false;
    if (!hasNote || hasConflict) return;
    if (contentRef.current === lastContentRef.current) return;
    void persistContentNow(contentRef.current, { syncReason: 'after-transition' });
  }, [content, hasConflict, hasNote, paneLocked, persistContentNow]);

  useEffect(() => {
    if (!hasNote || content === lastContentRef.current || hasConflict) return undefined;
    if (content === failedContentRef.current) return undefined;
    // During a switch the pane's note id is still the note being left: a draft
    // written now would file the new note's text under the old note's id.
    if (paneTransitionRef.current) return undefined;
    const timeout = setTimeout(() => {
      void writeDraft(noteId, content).catch((error) => {
        console.error('Failed to persist note draft:', error);
      });
    }, 100);
    return () => clearTimeout(timeout);
  }, [content, hasConflict, hasNote, lastContentRef, noteId, paneLocked, writeDraft]);

  useEffect(() => {
    if (!hasNote) return;

    if (hasConflict) {
      clearPendingSave();
      return undefined;
    }

    if (saveTimeoutRef.current) {
      clearPendingSave();
    }

    // While a new note is being created the pane carries the previous note's id,
    // so nothing may be written yet. The person can still type — swallowing those
    // keystrokes would be its own kind of loss — and the save fires the moment the
    // pane points at the note the text belongs to.
    if (paneTransitionRef.current) {
      return undefined;
    }

    if (content !== lastContentRef.current) {
      // Text that already failed to save is not "saving" again: saying so put the
      // footer back on "Saving…" the moment the failure was reported, and it never
      // left. Status stays 'error' until the person types something new or retries.
      if (content !== failedContentRef.current && saveStatusRef.current !== 'saving') {
        saveStatusRef.current = 'saving';
        setSaveStatus('saving');
      }
    } else if (saveStatusRef.current === 'saving') {
      saveStatusRef.current = 'idle';
      setSaveStatus('idle');
    }

    const saveContent = async () => {
      const latestContent = contentRef.current;
      if (latestContent === failedContentRef.current) return;
      if (latestContent === lastContentRef.current) {
        if (saveStatusRef.current === 'saving') {
          saveStatusRef.current = 'idle';
          setSaveStatus('idle');
        }
        return;
      }
      await persistContentNow(latestContent, { syncReason: 'autosave' });
      // Only a real failure blocks a retry. `false` is also what a save answers
      // when it was skipped on purpose (the note moved on, the draft was already
      // saved) — marking those failed would silently stop saving that text.
      if (saveStatusRef.current === 'error') failedContentRef.current = latestContent;
    };

    // A quiet moment, but not before MIN_SAVE_DELAY has passed. `requestIdleCallback`
    // alone fires between keystrokes — the browser is idle for the 60 ms between two
    // keys — and a signed-in note then cost one PATCH *per character*: typing a
    // 72-character sentence made 72 canonical writes and 72 versions (a one-line note
    // reached revision 195). The delay coalesces a burst of typing into one write
    // while keeping the idle callback's promise: never while the person is working.
    const MIN_SAVE_DELAY = 500;
    let idleId = null;
    const idleTimer = setTimeout(() => {
      if ('requestIdleCallback' in window) {
        idleId = requestIdleCallback(saveContent, { timeout: 1500 });
      } else {
        void saveContent();
      }
    }, MIN_SAVE_DELAY);
    saveTimeoutRef.current = () => {
      clearTimeout(idleTimer);
      if (idleId !== null && 'cancelIdleCallback' in window) cancelIdleCallback(idleId);
    };

    return () => {
      if (saveTimeoutRef.current) {
        saveTimeoutRef.current();
        saveTimeoutRef.current = null;
      }
    };
  }, [clearPendingSave, content, hasConflict, hasNote, lastContentRef, paneLocked, persistContentNow]);

  useEffect(() => {
    if (!user || !storage || !noteId) return undefined;

    const flushBeforeLeave = () => {
      void flushLocalSnapshot({ fireAndForget: true, reason: 'pagehide' });
    };

    window.addEventListener('pagehide', flushBeforeLeave);
    window.addEventListener('beforeunload', flushBeforeLeave);

    return () => {
      window.removeEventListener('pagehide', flushBeforeLeave);
      window.removeEventListener('beforeunload', flushBeforeLeave);
    };
  }, [flushLocalSnapshot, noteId, storage, user]);

  useEffect(
    () => () => {
      if (!user || !storage || !noteId) return;
      void flushLocalSnapshot({ fireAndForget: true, reason: 'pane-unmount' });
    },
    [flushLocalSnapshot, noteId, storage, user]
  );

  useEffect(() => {
    if (!hasNote || !('BroadcastChannel' in window)) return undefined;
    const channel = new BroadcastChannel(NOTES_BROADCAST_CHANNEL);
    channel.onmessage = (event) => {
      if (event?.data?.type !== 'notes-changed' || event.data.noteId !== noteId) return;
      if (contentRef.current === lastContentRef.current) {
        void runContentLoad(noteId);
      }
      // Dirty panes keep their draft. Their next CAS save will either succeed or
      // receive the canonical content as a real revision conflict.
    };
    return () => channel.close();
  }, [contentRef, hasNote, lastContentRef, noteId, runContentLoad]);

  // Another client — an agent, or a person on a phone — wrote to the open note.
  // The presence poll saw the revision move and said so. The same rule as a
  // second tab: a clean pane takes the new text, a dirty one keeps its draft and
  // its next guarded save either wins or hits the conflict path.
  useEffect(() => {
    if (!hasNote || !noteId) return undefined;
    const onRemoteRevision = (event) => {
      const detail = event?.detail;
      if (!detail || detail.noteId !== noteId) return;
      const known = Number(canonicalRevisionRef.current.get(noteId));
      if (Number.isFinite(known) && Number(detail.revision) <= known) return;
      if (contentRef.current === lastContentRef.current) {
        void runContentLoad(noteId);
      }
    };
    window.addEventListener('canonote:remote-revision', onRemoteRevision);
    return () => window.removeEventListener('canonote:remote-revision', onRemoteRevision);
  }, [contentRef, hasNote, lastContentRef, noteId, runContentLoad]);

  const loadNoteContent = useCallback(
    async (targetNoteId, options) => {
      if (!targetNoteId) return null;
      manualLoadNoteRef.current = targetNoteId;
      try {
        return await runContentLoad(targetNoteId, options);
      } finally {
        if (manualLoadNoteRef.current === targetNoteId) {
          manualLoadNoteRef.current = null;
        }
      }
    },
    [runContentLoad]
  );

  const retrySave = useCallback(async () => {
    if (!hasNote || saveStatusRef.current !== 'error') return;
    failedContentRef.current = null;
    await persistContentNow(contentRef.current, { syncReason: 'retry-save' });
  }, [contentRef, hasNote, persistContentNow]);

  useEffect(() => {
    if (!hasNote) return undefined;
    const handleOnline = () => {
      if (
        saveStatusRef.current === 'error' &&
        contentRef.current !== lastContentRef.current &&
        !hasConflictRef.current
      ) {
        void persistContentNow(contentRef.current, { syncReason: 'online-retry' });
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [contentRef, hasConflictRef, hasNote, lastContentRef, persistContentNow]);

  const reloadFromStorage = useCallback(
    async (targetNoteId = noteId, options) => {
      if (!targetNoteId) return false;
      const loadedContent = await loadNoteContent(targetNoteId, options);
      if (typeof loadedContent === 'string') {
        setConflictRecovery('resolved-incoming');
        saveStatusRef.current = 'idle';
        setSaveStatus('idle');
        setSaveError(null);
        return true;
      }
      // Load was superseded by a concurrent request (returns null). The user
      // explicitly chose to discard their draft — clear the persisted conflict
      // so it doesn't resurrect on the next page load.
      if (options?.discardDraft) {
        await clearPersistedConflictSnapshot(targetNoteId).catch(() => {});
        clearConflictRecovery();
        saveStatusRef.current = 'idle';
        setSaveStatus('idle');
        setSaveError(null);
      }
      return false;
    },
    [clearConflictRecovery, clearPersistedConflictSnapshot, loadNoteContent, noteId, setConflictRecovery]
  );

  const restoreConflictDraft = useCallback(
    (options = {}) => {
      if (!restoreConflictDraftContent(options)) return false;
      saveStatusRef.current = 'conflict';
      setSaveStatus('conflict');
      setSaveError(conflictMessage);
      return true;
    },
    [conflictMessage, restoreConflictDraftContent]
  );

  const saveLocalDraft = useCallback(async () => {
    if (!hasNote) return false;
    const draft = conflictSnapshotRef.current?.localContent ?? contentRef.current;
    const saved = await persistContentNow(draft, {
      force: true,
      preserveConflictRecovery: true,
      syncReason: 'conflict-save-local',
    });
    if (saved) {
      setConflictRecovery('resolved-local');
    }
    return saved;
  }, [conflictSnapshotRef, contentRef, hasNote, persistContentNow, setConflictRecovery]);

  const acceptIncoming = useCallback(
    async (options = {}) => {
      if (!hasNote) return false;
      return reloadFromStorage(noteId, {
        ...options,
        allowLocalFallback: false,
        discardDraft: true,
      });
    },
    [hasNote, noteId, reloadFromStorage]
  );

  const flushPendingChanges = useCallback(async () => {
    if (!hasNote || hasConflictRef.current) return false;
    const latestContent = getLatestContentForPersistence();
    if (latestContent === lastContentRef.current) {
      clearPendingSave();
      return false;
    }
    return persistContentNow(latestContent, { syncReason: 'pane-flush' });
  }, [
    clearPendingSave,
    getLatestContentForPersistence,
    hasConflictRef,
    hasNote,
    lastContentRef,
    persistContentNow,
  ]);

  const applyExternalContent = useCallback(
    async (nextContent, { shouldFocus = false, force = false } = {}) => {
      if (!hasNote) return false;

      clearPendingSave();

      saveStatusRef.current = 'saving';
      setSaveStatus('saving');
      setSaveError(null);
      setContent(nextContent);

      if (shouldFocus && editorRef.current) {
        editorRef.current.focus?.();
        editorRef.current.setSelection?.(nextContent.length);
      }

      return persistContentNow(nextContent, { force, syncReason: 'external-apply' });
    },
    [clearPendingSave, editorRef, hasNote, persistContentNow, setContent]
  );

  const adoptCanonicalContent = useCallback(
    async (nextContent, { revision = null, updated = Date.now(), shouldFocus = false } = {}) => {
      if (!hasNote || typeof nextContent !== 'string') return false;
      clearPendingSave();
      if (revision) {
        writeCanonicalRevision(noteId, revision);
        bindContentRevision(noteId, revision, 'adopt-canonical-content');
      }
      syncedCanonicalContentRef.current.set(noteId, nextContent);
      const localContent = contentRef.current;
      const hasDirtyDraft = localContent !== lastContentRef.current;
      if (hasDirtyDraft && localContent !== nextContent) {
        await writeDraft(noteId, localContent);
        setConflictRecovery('conflicted', nextContent);
        saveStatusRef.current = 'conflict';
        setSaveStatus('conflict');
        setSaveError(conflictMessage);
        return false;
      }
      setContent(nextContent);
      contentRef.current = nextContent;
      lastContentRef.current = nextContent;
      if (shouldFocus && editorRef.current) {
        editorRef.current.focus?.();
        editorRef.current.setSelection?.(nextContent.length);
      }
      await Promise.all([
        // Adopting the canonical content supersedes the local journal record
        // outright — that is what adoption means, so the record goes with it.
        commitContent(noteId, nextContent, { clearDraft: 'always' }),
        clearPersistedConflictSnapshot(noteId),
      ]);
      clearConflictRecovery();
      markContentSaved(nextContent, updated);
      if (revision && notes?.updateNoteInList) {
        notes.updateNoteInList(noteId, getPreviewTitle(nextContent) || 'Untitled', updated, {
          revision,
        });
      }
      return true;
    },
    [
      clearConflictRecovery,
      clearPendingSave,
      clearPersistedConflictSnapshot,
      commitContent,
      conflictMessage,
      contentRef,
      editorRef,
      getPreviewTitle,
      hasNote,
      lastContentRef,
      markContentSaved,
      noteId,
      notes,
      setContent,
      storage,
      setConflictRecovery,
      writeCanonicalRevision,
      writeDraft,
    ]
  );

  return {
    hasNote,
    hideForSwitch,
    noteOwnsContent: () => {
      // Typed during a switch belongs to the note the pane is about to show, not
      // to the one it is leaving — so it is owned by nobody until the id arrives.
      contentNoteIdRef.current = paneTransitionRef.current ? null : noteId;
    },
    beginPaneTransition,
    clearForSwitch,
    endPaneTransition,
    paneLocked,
    contentLoading,
    agentSpans,
    saveStatus,
    saveError,
    loadNoteContent,
    retrySave,
    reloadFromStorage,
    restoreConflictDraft,
    saveLocalDraft,
    acceptIncoming,
    flushPendingChanges,
    applyExternalContent,
    adoptCanonicalContent,
  };
};
