import { getUserSessionAuthHeaders } from '../utils/apiAuth';

export class NotesApiError extends Error {
  constructor(message, { status = 0, data = null } = {}) {
    super(message);
    this.name = 'NotesApiError';
    this.status = status;
    this.data = data;
  }
}

// A save queue is serial, so a request that never settles stops the note from
// syncing and says nothing: a dropped connection is the normal way to reach that.
const REQUEST_TIMEOUT_MS = 15_000;

const request = async (path, options = {}) => {
  const headers = await getUserSessionAuthHeaders(options.headers || {});
  let response;
  try {
    response = await fetch(`/api/notes${path}`, {
      ...options,
      headers,
      signal: options.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new NotesApiError('The notebook did not answer in time.', { status: 0 });
    }
    throw new NotesApiError('The notebook could not be reached.', { status: 0 });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.success) {
    throw new NotesApiError(payload?.error || `Notes request failed (${response.status})`, {
      status: response.status,
      data: payload,
    });
  }
  return payload.data;
};

export const notesApi = {
  list: () => request(''),
  search: (query) => request(`?${new URLSearchParams({ q: query })}`),
  get: (noteId) => request(`/${encodeURIComponent(noteId)}`),
  history: (noteId, limit = 30) =>
    request(`/${encodeURIComponent(noteId)}/history?limit=${limit}`),
  // Presence is read from the agent function, where it is also written: the store
  // is that function's memory, and /api/notes is a different function.
  presence: async (noteId) => {
    const headers = await getUserSessionAuthHeaders();
    const response = await fetch(`/api/agent/notes/${encodeURIComponent(noteId)}/presence`, { headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.success) {
      throw new NotesApiError(payload?.error || `Presence request failed (${response.status})`, {
        status: response.status,
        data: payload,
      });
    }
    return payload.data;
  },
  // The person's own caret, written to the same function that answers the poll.
  // Without this an agent can only guess where the person is typing: the
  // BroadcastChannel never leaves the browser.
  announcePresence: async (noteId, { from, to }) => {
    const headers = await getUserSessionAuthHeaders({ 'Content-Type': 'application/json' });
    const body = { from };
    if (Number.isInteger(to)) body.to = to;
    const response = await fetch(`/api/agent/notes/${encodeURIComponent(noteId)}/presence`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.success) {
      throw new NotesApiError(payload?.error || `Presence request failed (${response.status})`, {
        status: response.status,
        data: payload,
      });
    }
    return payload.data;
  },
  // The thread on a note. `since` makes the poll cheap: a quiet note answers with
  // an empty list and the same cursor it was given.
  messages: (noteId, since = null) => {
    const query = since ? `?${new URLSearchParams({ since })}` : '';
    return request(`/${encodeURIComponent(noteId)}/messages${query}`);
  },
  postMessage: (noteId, message) =>
    request(`/${encodeURIComponent(noteId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    }),
  decideMessage: (noteId, messageId, applied) =>
    request(`/${encodeURIComponent(noteId)}/messages/${encodeURIComponent(messageId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applied }),
    }),
  revert: (noteId, revision) =>
    request(`/${encodeURIComponent(noteId)}/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision }),
    }),
  create: (note) =>
    request('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note),
    }),
  update: (noteId, changes) =>
    request(`/${encodeURIComponent(noteId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    }),
  delete: (noteId, ifRevision = null) =>
    request(`/${encodeURIComponent(noteId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ifRevision }),
    }),
};
