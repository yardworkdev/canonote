/**
 * The user's own name for their agent.
 *
 * The product ships with a neutral fallback ("Agent"); nothing writes a
 * person's assistant name into a notebook any more. The name a user picks is a
 * device-local preference, so it lives next to the theme and the other local
 * settings, read and written through the same browser-storage helpers the rest
 * of the app uses (which the storage seam is built on).
 */

import {
  readBrowserStorageValue,
  removeBrowserStorageValue,
  writeBrowserStorageValue,
} from './browser-storage';
import { DEFAULT_AGENT_NAME, agentDisplayName } from '../constants/agent';

export const AGENT_NAME_KEY = 'agent-name';

/** Long enough for "Claude Code" or "my research helper", short enough for a row. */
export const MAX_AGENT_NAME_LENGTH = 40;

/**
 * Trim, collapse whitespace and cap the length. An empty result means "not
 * set", which is what every caller treats as the neutral default.
 */
export const normalizeAgentName = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, MAX_AGENT_NAME_LENGTH).trim();
};

/** The name the user gave their agent, or the neutral default. */
export const readAgentName = () =>
  agentDisplayName(normalizeAgentName(readBrowserStorageValue(AGENT_NAME_KEY)));

/**
 * Persist the user's agent name and return the effective name. An empty value
 * clears the setting instead of storing an empty string, so "unset" and
 * "cleared" behave the same everywhere.
 */
export const writeAgentName = (value) => {
  const normalized = normalizeAgentName(value);
  if (normalized) writeBrowserStorageValue(AGENT_NAME_KEY, normalized);
  else removeBrowserStorageValue(AGENT_NAME_KEY);
  return normalized || DEFAULT_AGENT_NAME;
};
