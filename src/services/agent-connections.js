import { getUserSessionAuthHeaders } from '../utils/apiAuth';

/**
 * Agent connections, from the person's side.
 *
 * Three calls and no state: the panel that shows them keeps whatever it needs.
 * Everything here answers with the shape /api/agent/connections already returns.
 */

const readData = async (response) => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  return payload.data;
};

export const listAgentConnections = async () => {
  const headers = await getUserSessionAuthHeaders();
  if (!headers.Authorization) return [];
  const response = await fetch('/api/agent/connections', { headers });
  const payload = await response.json().catch(() => ({}));
  return Array.isArray(payload?.data) ? payload.data : [];
};

/**
 * One call, one token. Thirty days, notes:read and notes:write — the two scopes
 * that mean "can read and write the notes you left switched on". There is no
 * expiry picker: a token that outlives its usefulness is revoked in the same tab.
 */
export const issueAgentToken = async ({ agentLabel, days = 30 }) => {
  const headers = await getUserSessionAuthHeaders({ 'Content-Type': 'application/json' });
  const expiresAt = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() : null;
  const response = await fetch('/api/agent/connections', {
    method: 'POST',
    headers,
    body: JSON.stringify({ agentLabel, scopes: ['notes:read', 'notes:write'], expiresAt }),
  });
  return readData(response);
};

export const revokeAgentConnection = async (connectionId) => {
  const headers = await getUserSessionAuthHeaders();
  const response = await fetch(`/api/agent/connections/${encodeURIComponent(connectionId)}`, {
    method: 'DELETE',
    headers,
  });
  if (response.status === 204) return null;
  return readData(response);
};
