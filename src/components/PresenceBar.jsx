import React from 'react';
import { Eye } from 'lucide-react';
import { describePresence } from '../services/presence-codec';

/**
 * Who is here, in the footer next to the save state.
 *
 * Deliberately quiet: a name and what an agent is doing, no avatars, no pulse, no
 * "AI is thinking" badge. Presence is a courtesy; it should be readable in a
 * glance and never demand one.
 */
export default function PresenceBar({ others = [] }) {
  if (!others.length) return null;
  return (
    <span className="flex items-center gap-2" aria-live="polite" data-presence-bar="">
      <Eye className="w-3 h-3 text-gray-500" aria-hidden="true" />
      {others.map((entry) => (
        <span
          key={entry.id}
          data-presence-entry={entry.kind}
          className={`text-xs ${
            entry.kind === 'agent' ? 'text-gray-300' : 'text-gray-400'
          }`}
          title={
            entry.kind === 'agent'
              ? `An agent is in this note: ${describePresence(entry)}`
              : `${entry.name} has this note open`
          }
        >
          {describePresence(entry)}
        </span>
      ))}
    </span>
  );
}
