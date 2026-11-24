import React, { useCallback, useEffect, useState } from 'react';
import { Bot, Check, Copy, KeyRound, Trash2 } from 'lucide-react';
import Tooltip from './Tooltip';
import { MAX_AGENT_NAME_LENGTH, normalizeAgentName, readAgentName, writeAgentName } from '../services/agent-settings';
import { issueAgentToken, listAgentConnections, revokeAgentConnection } from '../services/agent-connections';
import { formatRelativeTime } from '../utils/time';

/**
 * Agents, in one place, with one button.
 *
 * The old panel asked a person to name an agent, pick an expiry from a dropdown,
 * click "Issue delegated token from current session", and then — separately —
 * paste a token into a second field and save it. Five controls for a job that is
 * one decision: give this agent a token.
 *
 * What is left is the decision. A name, already remembered, and one button. The
 * token appears once, can be copied, and lives in the connections list under it
 * where it can be revoked. Expiry is thirty days and scopes are fixed: anything
 * an agent could do differently here, it can be stopped from doing by switching
 * the note off in the sidebar, which is the control that matters.
 */
const formButton =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-gray-600/60 bg-gray-700/40 px-3 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-700/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:cursor-not-allowed disabled:opacity-50';

export default function AgentTab({ agentsEnabled = true, onSignInToUseAgents }) {
  const [agentName, setAgentName] = useState(() => readAgentName() || 'Agent');
  const [token, setToken] = useState('');
  const [connections, setConnections] = useState([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    try {
      setConnections(await listAgentConnections());
    } catch {
      // A list that cannot be read is not an error worth shouting about; the
      // button below still works and the server is the source of truth.
      setConnections([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const changeName = (value) => {
    const next = normalizeAgentName(value);
    setAgentName(next);
    writeAgentName(next);
  };

  const createToken = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = await issueAgentToken({ agentLabel: normalizeAgentName(agentName) || 'Agent' });
      if (!data?.token) throw new Error('No token came back.');
      setToken(data.token);
      setBusy(false);
      // The list is a convenience; a slow refresh must not leave the button
      // saying "Creating…" under a token that already exists.
      void refresh();
    } catch (issueError) {
      setError(issueError.message || 'Could not create a token.');
      setBusy(false);
    }
  };

  // Copy something an agent can act on, not 38 characters it has to be told what
  // to do with. This is the paste that turns "here is a token" into "your agent
  // can read your notebook".
  const tokenBlockText = () =>
    [
      'canonote agent access',
      `base  ${typeof window === 'undefined' ? '' : window.location.origin}/api/agent`,
      `token ${token}`,
      `try   curl -H "Authorization: Bearer ${token}" ${typeof window === 'undefined' ? '' : window.location.origin}/api/agent/notes`,
    ].join('\n');

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(tokenBlockText());
      setCopied(true);
      // A secret that stays on screen is a secret waiting to be read over a
      // shoulder; once it is on the clipboard the card has done its job.
      setTimeout(() => {
        setCopied(false);
        setToken('');
      }, 1600);
    } catch {
      setError('Copying is blocked in this browser. Select the token and copy it.');
    }
  };

  const revoke = async (connectionId) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await revokeAgentConnection(connectionId);
      // The row goes at once: waiting for a refetch made revocation look like it
      // had not happened, which is the one thing a revoke button must never do.
      setConnections((previous) => previous.filter((item) => item.id !== connectionId));
      setNotice('Token revoked. The agent lost access on its next call.');
      await refresh();
    } catch (revokeError) {
      setError(revokeError.message || 'Could not revoke that token.');
    } finally {
      setBusy(false);
    }
  };

  // A device-only notebook has no account, so there is nothing to give a token
  // to. Say that here rather than offering a button that cannot work.
  if (!agentsEnabled) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <Bot className="h-5 w-5 text-gray-500" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-gray-400">
          Agents need an account. This notebook lives in this browser only.
        </p>
        {onSignInToUseAgents && (
          <button type="button" onClick={onSignInToUseAgents} className={formButton}>
            Sign in to use agents
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      <div className="flex items-center gap-1.5 text-xs text-gray-400">
        <Bot className="h-3.5 w-3.5" aria-hidden="true" />
        <Tooltip label="It writes under its own name, and you can switch it off for any note.">
          <span className="cursor-help">An agent, with your permission</span>
        </Tooltip>
      </div>

      <label className="mt-3 flex items-center gap-2 text-xs text-gray-400">
        <Tooltip label="The name your agent's changes are signed with">
          <span className="shrink-0 cursor-help">Called</span>
        </Tooltip>
        <input
          type="text"
          value={agentName}
          onChange={(event) => changeName(event.target.value)}
          onBlur={() => changeName(agentName)}
          maxLength={MAX_AGENT_NAME_LENGTH}
          aria-label="Agent name"
          className="min-w-0 flex-1 rounded border border-gray-700/60 bg-transparent px-1.5 py-1 text-gray-200 focus:border-gray-500 focus:outline-none"
        />
      </label>

      <Tooltip label="Thirty days, read and write. Revoke it below.">
        <button type="button" onClick={createToken} disabled={busy} className={`mt-3 w-full ${formButton}`}>
          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
          {busy ? 'Creating…' : token ? 'Create another token' : 'Create token'}
        </button>
      </Tooltip>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-red-400/20 bg-red-400/10 px-2.5 py-2 text-[11px] text-red-200">
          {error}
        </p>
      )}

      {notice && !error && (
        <p role="status" className="mt-3 rounded-lg border border-gray-700/60 bg-gray-800/40 px-2.5 py-2 text-[11px] text-gray-300">
          {notice}
        </p>
      )}

      {token && (
        <div className="mt-3 rounded-lg border border-gray-700/60 bg-gray-800/40 p-2.5">
          <p className="text-[11px] text-gray-400">Shown once. Copying hides it.</p>
          <code className="mt-1.5 block break-all rounded bg-black/30 px-2 py-1.5 text-[11px] text-gray-200">{token}</code>
          <div className="mt-2 flex gap-2">
            <Tooltip label="Token, base URL and one example call — paste it to your agent">
              <button type="button" onClick={copyToken} className={`flex-1 ${formButton}`}>
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy for your agent'}
              </button>
            </Tooltip>
            <button type="button" onClick={() => setToken('')} className={formButton}>
              Done
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-gray-700/50 pt-3">
        <p className="text-[11px] uppercase tracking-wide text-gray-500">
          {connections.length === 0 ? 'No tokens yet' : `${connections.length} token${connections.length === 1 ? '' : 's'}`}
        </p>
        {connections.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {connections.map((connection) => (
              <li key={connection.id} className="flex items-center gap-2 rounded-lg border border-gray-700/50 px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[11px] text-gray-300">
                  {connection.agentLabel || 'Agent'}
                  <span className="text-gray-500">
                    {' · '}
                    {connection.lastUsedAt
                      ? `used ${formatRelativeTime(Date.parse(connection.lastUsedAt))}`
                      : 'never used'}
                    {connection.expiresAt ? ` · until ${String(connection.expiresAt).slice(0, 10)}` : ''}
                  </span>
                </span>
                <Tooltip label="Revoke now — the agent loses access on its next call">
                <button
                  type="button"
                  onClick={() => revoke(connection.id)}
                  disabled={busy}
                  aria-label={`Revoke ${connection.agentLabel || 'agent'} token`}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-red-400/10 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
          A note is open to agents unless you hide it: the eye in the sidebar switches it off, and a
          hidden note answers 404 as if it did not exist.
        </p>
      </div>
    </div>
  );
}
