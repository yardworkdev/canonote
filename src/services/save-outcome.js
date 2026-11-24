/**
 * What a save attempt means.
 *
 * The hook around this is long because it wires timers, refs and two storage
 * layers. The part that decides *what happened* does not need any of that, and
 * used to live inline in four branches where only one of them was ever tested.
 *
 * One table, one place: given the server's answer, say what the user should be
 * told and what the pipeline should do next.
 */

export const SAVE_KINDS = ['saved', 'conflict', 'missing', 'precondition', 'error', 'offline'];

const MESSAGES = {
  conflict:
    'Reload this note before saving. Your draft is saved locally and was not written over the server copy.',
  missing: 'This note was deleted or is no longer available. Your draft is preserved locally.',
  precondition: 'This note changed on the server. Reload it, then save again.',
  offline: 'You are offline. Your draft is saved in this browser and will sync when you reconnect.',
  error: 'The note could not be saved to the server. Your draft is preserved locally.',
};

/**
 * @param {{ status?: number, code?: string|null, message?: string|null, online?: boolean }} input
 * @returns {{ kind: string, message: string, retryable: boolean, keepDraft: boolean, rebase: boolean }}
 */
export function describeSaveOutcome({ status = 0, code = null, message = null, online = true } = {}) {
  const base = { retryable: false, keepDraft: true, rebase: false };

  if (online === false) {
    return { ...base, kind: 'offline', message: MESSAGES.offline, retryable: true };
  }

  switch (status) {
    case 200:
    case 201:
      return { kind: 'saved', message: '', retryable: false, keepDraft: false, rebase: false };
    case 409:
      return { ...base, kind: 'conflict', message: MESSAGES.conflict, rebase: true };
    case 428:
      return { ...base, kind: 'precondition', message: MESSAGES.precondition, rebase: true };
    case 404:
      // The note is gone on purpose. Resurrecting it would silently undo a delete,
      // so the draft is kept locally and nothing is written back.
      return { ...base, kind: 'missing', message: MESSAGES.missing, retryable: false };
    case 401:
    case 403:
      return { ...base, kind: 'error', message: 'You are not allowed to save this note. Sign in again.' };
    case 429:
      return { ...base, kind: 'error', message: MESSAGES.error, retryable: true };
    default: {
      if (code === 'REVISION_CONFLICT') return { ...base, kind: 'conflict', message: MESSAGES.conflict, rebase: true };
      // 5xx and a timeout: the server's own sentence is a database or deployment
      // detail, and it is not something a person can act on. Say what happened in
      // product terms and keep the draft.
      const actionable = status >= 400 && status < 500 && status !== 0;
      return {
        ...base,
        kind: 'error',
        message: actionable && message ? message : MESSAGES.error,
        retryable: status >= 500 || status === 0 || status === 429,
      };
    }
  }
}
