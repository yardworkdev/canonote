import { useCallback, useEffect, useState } from 'react';
import { readAgentName, writeAgentName } from '../services/agent-settings';

/**
 * The name the user gave their agent, kept in sync across every surface.
 *
 * Two components can show the same name (the sidebar's agent section and the
 * settings field), so a write broadcasts an event rather than each copy
 * re-reading storage on a timer.
 */
export const AGENT_NAME_EVENT = 'agent-name-updated';

export const useAgentName = () => {
  const [agentName, setAgentNameState] = useState(readAgentName);

  useEffect(() => {
    const handleUpdate = (event) => {
      setAgentNameState(event?.detail?.name || readAgentName());
    };
    window.addEventListener(AGENT_NAME_EVENT, handleUpdate);
    return () => window.removeEventListener(AGENT_NAME_EVENT, handleUpdate);
  }, []);

  const setAgentName = useCallback((value) => {
    const next = writeAgentName(value);
    setAgentNameState(next);
    window.dispatchEvent(new CustomEvent(AGENT_NAME_EVENT, { detail: { name: next } }));
    return next;
  }, []);

  return { agentName, setAgentName };
};

export default useAgentName;
