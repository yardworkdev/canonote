/**
 * Every message the notebook says out loud, in one place.
 *
 * Slice 1's last design item: *one notice system with a documented tone, and
 * every message under test*. The app had one notice *surface* (the toast, plus
 * the inline marks in a helper panel) and four voices: the same kind of failure
 * was a sentence here and a fragment there, one message shouted
 * ("Text improved successfully!"), one told the user to do something the app
 * would refuse again, and two gave no next step at all. Copy written inline at
 * the call site cannot be reviewed, cannot be counted, and cannot be tested —
 * which is how "Copied!" sat next to "Copied the conflicted draft to your
 * clipboard." for months.
 *
 * So the copy lives here, keyed, with its tone, and the call sites name a key.
 * `src/services/notices.test.js` holds every entry to the standard below and
 * fails if a notice call site passes prose instead of a key.
 *
 * ## The tone standard
 *
 * A notice is an icon, one sentence and an optional action (BRAND.md). Beyond
 * that, every message here satisfies all of these, and the test suite enforces
 * them one by one:
 *
 * 1. **One of four tones.** `success`, `info`, `warning`, `error`. The tone is
 *    a claim about the message, and the mark next to it must match it.
 * 2. **At most two sentences: the fact, then the step.** The first sentence
 *    says what happened. The second, when there is one, is what the reader can
 *    do about it. Never three.
 * 3. **Plain language, no hype.** Sentence case, ends in a full stop, no
 *    exclamation mark, no question mark, no emoji. "Improved the selected
 *    text." — not "Text improved successfully!".
 * 4. **No blame and no apology.** The app does not say "Oops", "Sorry" or
 *    "unfortunately"; it says what happened.
 * 5. **An error names a next step that can actually help.** "Please retry" is
 *    only allowed where a retry can clear the failure — a browser that blocks
 *    storage will refuse the retry too, so that case says what to change
 *    instead. This is the rule the storage vocabulary was already built on
 *    (`src/services/storage-failure.js`); it is now the rule for every error.
 * 6. **Numbers, not adjectives.** A count the app knows is stated.
 * 7. **One glance.** 140 characters at most, single spaces, no trailing space.
 *
 * The rules are exported (`NOTICE_RULES`) so the documentation and the test
 * read the same list.
 */

export const NOTICE_TONES = ['success', 'info', 'warning', 'error'];

export const DEFAULT_NOTICE_DURATION = 5000;

export const MAX_NOTICE_LENGTH = 140;

/**
 * The phrases that count as a next step for an `error` notice. A message may
 * name any one of them; the point is that it names *something* the reader can
 * do, rather than only what went wrong.
 */
export const NOTICE_STEP_PHRASES = [
  'try again',
  'please retry',
  'reload',
  'check',
  'choose',
  'export',
  'allow site data',
  'set up',
  'select',
  'wait',
];

export const NOTICE_RULES = [
  'the tone is one of success, info, warning, error',
  'at most two sentences: the fact, then the step',
  'plain language: sentence case, ends in a full stop, no ! or ?, no emoji',
  'no blame and no apology: no "Oops", no "Sorry", no "unfortunately"',
  'an error names a next step that can actually help',
  'numbers, not adjectives, wherever the app knows the number',
  `one glance: ${MAX_NOTICE_LENGTH} characters at most, single spaces`,
];

/**
 * Words the app does not use: blame, apology and hype. Exported so the test
 * suite and the documentation read the same list the copy is written against.
 */
export const NOTICE_BANNED_WORDS = [
  'oops',
  'sorry',
  'unfortunately',
  'apolog',
  'successfully',
  'awesome',
  'simply',
  'just ',
  'easily',
  'perfect',
];

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * The copy. Each entry is `{ tone, text, duration? }`; `text` is a string, or a
 * function of the numbers and names the message needs. Keys are named after the
 * event, not the surface — one event has one message wherever it is shown.
 */
export const NOTICES = Object.freeze({
  // --- Import -------------------------------------------------------------
  importAlreadyHere: {
    tone: 'info',
    text: 'Those notes are already in your notebook.',
  },
  importNothingFound: {
    tone: 'info',
    text: 'No markdown files found to import.',
  },
  imported: {
    tone: 'success',
    text: ({ imported = 0, skipped = 0 } = {}) => {
      const first = `Imported ${plural(imported, 'note', 'notes')}.`;
      return skipped ? `${first} Skipped ${skipped} already here.` : first;
    },
  },

  // --- Saving -------------------------------------------------------------
  saveFailed: {
    tone: 'error',
    duration: 7000,
    text: 'Failed to save note. Please retry.',
  },
  storageBlocked: {
    tone: 'error',
    duration: 7000,
    text: 'This browser is blocking storage. Allow site data for this page, then reload.',
  },
  storageFull: {
    tone: 'error',
    duration: 7000,
    text: 'Storage is full. Export your notes, then delete a note to free space.',
  },

  // --- Conflicts ----------------------------------------------------------
  conflictDetected: {
    tone: 'warning',
    duration: 8000,
    text: 'A conflict was detected for this note. Use the conflict actions below to restore, copy, or replace your draft.',
  },
  conflictDraftRestored: {
    tone: 'info',
    text: 'Restored your local draft in the editor. Save it to keep it.',
  },
  conflictDraftCopied: {
    tone: 'success',
    text: 'Copied the conflicted draft to your clipboard.',
  },
  conflictCopyFailed: {
    tone: 'error',
    text: 'Could not copy the conflicted draft. Select it in the editor and copy it instead.',
  },
  localDraftSaved: {
    tone: 'success',
    text: 'Saved your local draft over the newer version.',
  },
  localDraftSaveFailed: {
    tone: 'error',
    text: 'Could not save your local draft. Try again.',
  },
  serverVersionLoaded: {
    tone: 'success',
    duration: 4000,
    text: 'Loaded the current server version.',
  },
  agentSyncFailed: {
    tone: 'warning',
    duration: 6000,
    text: 'Agent sync failed. Check the agent connection in the AI settings.',
  },

  // --- The notebook -------------------------------------------------------
  noteAlreadyOpen: {
    tone: 'info',
    text: 'This note is already open in the other pane.',
  },
  deleteBlockedByConflict: {
    tone: 'error',
    text: 'This note changed elsewhere. Reload the page before deleting it.',
  },
  deleteFailed: {
    tone: 'error',
    text: 'Failed to delete note. Please retry.',
  },
  notesDeleteBlockedByConflict: {
    tone: 'error',
    text: 'These notes changed elsewhere. Reload the page before deleting them.',
  },
  notesDeleteFailed: {
    tone: 'error',
    text: 'Failed to delete notes. Please retry.',
  },

  // --- Backups and storage health ----------------------------------------
  backupBlocked: {
    tone: 'error',
    text: 'This browser is blocking storage, so a backup cannot be written. Allow site data for this page, then reload.',
  },
  backupNothing: {
    tone: 'warning',
    text: 'There is nothing to back up yet.',
  },
  backedUp: {
    tone: 'success',
    text: ({ count = 0 } = {}) => `Backed up ${plural(count, 'note', 'notes')}.`,
  },
  nothingToRestore: {
    tone: 'info',
    text: ({ skipped = 0 } = {}) =>
      `Nothing to restore — the notebook already has every note from that backup (${skipped}).`,
  },
  restored: {
    tone: 'success',
    text: ({ count = 0, when = 'earlier' } = {}) =>
      `Restored ${plural(count, 'note', 'notes')} from the backup taken ${when}.`,
  },

  // --- A folder the user picked -------------------------------------------
  folderConnected: {
    tone: 'success',
    text: ({ name = 'your folder' } = {}) =>
      `Your notes are .md files in “${name}” from now on.`,
  },
  folderStopped: {
    tone: 'info',
    text: 'The notebook is back in this browser. Your .md files stay in the folder.',
  },
  folderPermissionNeeded: {
    tone: 'warning',
    duration: 7000,
    text: 'Your notes folder needs permission again. Choose it once to reconnect.',
  },
  folderFailed: {
    tone: 'error',
    duration: 7000,
    text: 'That folder could not be opened. Choose a folder you can write to, then try again.',
  },

  // --- Export and the clipboard -------------------------------------------
  // The two confirmations below are shown inline, on the control that was used
  // (the check mark in the export dialog), rather than as a toast — the message
  // is about the button the reader just pressed, so it belongs on it. They live
  // here because they are messages: a call site names a key, never prose.
  exported: {
    tone: 'success',
    text: 'Exported.',
  },
  copied: {
    tone: 'success',
    text: 'Copied to clipboard.',
  },
  copyFailed: {
    tone: 'error',
    text: 'Could not copy to the clipboard. Select the text in the editor and copy it instead.',
  },
  printBlocked: {
    tone: 'error',
    text: 'The browser blocked the print window. Allow popups for this page, then try again.',
  },

  // --- The agent trail ----------------------------------------------------
  activityEmpty: {
    tone: 'info',
    text: 'No agent edits yet. Notes your agent changes show up here.',
  },
  activityNoSession: {
    tone: 'info',
    text: 'No account is connected, so there is no agent trail to read.',
  },
  activitySignedOut: {
    tone: 'info',
    text: 'The session has ended. Sign in again to read the agent trail.',
  },
  activityUnavailable: {
    tone: 'error',
    text: 'Could not read the agent activity. Try again in a moment.',
  },

  // --- The thread on a note -----------------------------------------------
  threadLocalOnly: {
    tone: 'info',
    text: 'This notebook is stored in this browser only, so there is no thread to share with an agent. Sign in to open one.',
  },
  threadEmpty: {
    tone: 'info',
    text: 'Nothing said yet. Your agent reads and writes here, and a change it wants shows up as a proposal you apply.',
  },
  threadUnavailable: {
    tone: 'error',
    text: 'Could not read the thread on this note. Try again in a moment.',
  },
  threadStale: {
    tone: 'warning',
    text: 'The thread did not refresh. What is below may be behind, and your note is unaffected.',
  },
  threadPosted: {
    tone: 'success',
    text: 'Message sent.',
  },
  threadPostFailed: {
    tone: 'error',
    text: 'The message did not send. Try again in a moment.',
  },
  proposalApplied: {
    tone: 'success',
    text: 'Applied the proposal to this revision of the note.',
  },
  proposalAppliedStale: {
    tone: 'warning',
    text: 'The note has changed since this proposal was written, so it was left out. Copy what is useful, or ask your agent again.',
  },
  proposalDismissed: {
    tone: 'info',
    text: 'Dismissed. The proposal stays in the thread.',
  },
});

const entryFor = (key) => {
  const entry = NOTICES[key];
  if (!entry) throw new Error(`Unknown notice "${key}".`);
  return entry;
};

/** The tone of a notice, for the surface that shows it. */
export const noticeTone = (key) => entryFor(key).tone;

/** The message text, with the numbers or names it needs. */
export const noticeText = (key, args) => {
  const { text } = entryFor(key);
  return typeof text === 'function' ? text(args) : text;
};

/** How long a notice stays on screen, unless the call site says otherwise. */
export const noticeDuration = (key) => entryFor(key).duration ?? DEFAULT_NOTICE_DURATION;

/** Message, tone and duration together — what a notice surface needs. */
export const notice = (key, args) => ({
  message: noticeText(key, args),
  tone: noticeTone(key),
  duration: noticeDuration(key),
});
