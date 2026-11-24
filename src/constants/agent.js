/**
 * Agent identity.
 *
 * Notes written by an agent (rather than by the human) are marked with an
 * agent folder and an `agent_*` author id. The previous build hardcoded one
 * person's assistant ("Rudi", folder `rudi`, author `agent_rudi`); those
 * values are still accepted so existing notebooks keep their grouping, but
 * nothing new is written with them and no user sees that name.
 */

export const AGENT_FOLDER = 'agent';
export const LEGACY_AGENT_FOLDER = 'rudi';

export const DEFAULT_AGENT_NAME = 'Agent';

const AGENT_FOLDERS = new Set([AGENT_FOLDER, LEGACY_AGENT_FOLDER]);

export const isAgentFolder = (folder) => AGENT_FOLDERS.has(folder);

// The agent's writes carry the bare actor id 'agent' (the delegated connection
// names the agent in `*_by_name`, one per connection). Older rows carry
// 'agent_rudi'. Both are agent authors; a person's id is a uuid.
export const isAgentAuthor = (authorId) =>
  typeof authorId === 'string' &&
  (authorId === 'agent' || authorId === 'agent_rudi' || authorId.startsWith('agent_'));

/** A note counts as agent-written if it is in the agent folder or was authored by an agent. */
export const isAgentNote = (note) => isAgentFolder(note?.folder) || isAgentAuthor(note?.createdBy);

/** Display name for an agent, falling back to a neutral label. */
export const agentDisplayName = (name) => (name && String(name).trim()) || DEFAULT_AGENT_NAME;
