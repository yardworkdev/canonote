import React from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

/**
 * The four states every helper panel wears, in one place.
 *
 * Contents, AI, History and Tags each grew their own header, their own empty
 * wording and their own type sizes, and two of them had no loading or error
 * state at all — so a history read the browser refused looked exactly like a
 * note with no versions, which is the same defect as a status row claiming
 * storage that is not there. One implementation, four panels.
 *
 * Shapes follow BRAND.md: an empty state is one line of text and one optional
 * action (no illustration, no oversized icon); a notice is an icon, one
 * sentence and an optional action, and errors say what happened, why, and the
 * next step.
 */

/** The one header: the panel's own fact on the left, controls on the right. */
export function PanelHeader({ label, action, children }) {
  return (
    <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-gray-700/50 px-4 py-2">
      <div className="flex min-w-0 items-center gap-3">
        {label ? <div className="truncate text-xs font-medium text-gray-400">{label}</div> : null}
        {children}
      </div>
      {action ? <div className="flex flex-shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

/** The one empty: one line, one optional action. */
export function PanelEmpty({ message, action }) {
  return (
    <div className="px-5 py-8 text-center">
      <p className="text-balance text-sm text-gray-400">{message}</p>
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** The one loading: a spinner and what is being read. */
export function PanelLoading({ label = 'Loading…' }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 px-5 py-8 text-xs text-gray-400"
    >
      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

/** The one error: what happened, the detail if there is one, and the step. */
export function PanelError({ message, detail, onRetry, retryLabel = 'Try again' }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 px-5 py-4 text-left">
      <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
      <div className="min-w-0 flex-1">
        <p className="text-pretty text-xs text-red-300">{message}</p>
        {detail ? <p className="text-pretty mt-1 text-xs text-gray-400">{detail}</p> : null}
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded-md border border-gray-600 px-3 py-1 text-[11px] font-medium text-gray-200 transition-colors duration-200 hover:bg-gray-700/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            {retryLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
