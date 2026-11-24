/**
 * Agent identity, server side.
 *
 * Delegated agent tokens and agent-authored notes carry a neutral identity.
 * The previous build hardcoded one person's assistant ("Rudi", `agent_rudi`,
 * folder `rudi`); those values are still accepted when reading so existing
 * data keeps working, but nothing new is written with them.
 */

export const AGENT_FOLDER = 'agent';
export const LEGACY_AGENT_FOLDER = 'rudi';
export const DEFAULT_AGENT_ID = 'agent';
export const DEFAULT_AGENT_NAME = 'Agent';
export const TOKEN_PREFIX = 'agent';

const AGENT_FOLDERS = new Set([AGENT_FOLDER, LEGACY_AGENT_FOLDER]);

export const isAgentFolder = (folder) => AGENT_FOLDERS.has(folder);

export const isAgentAuthor = (authorId) =>
  typeof authorId === 'string' && (authorId === 'agent_rudi' || authorId.startsWith('agent_'));

export const agentDisplayName = (name) => (name && String(name).trim()) || DEFAULT_AGENT_NAME;
