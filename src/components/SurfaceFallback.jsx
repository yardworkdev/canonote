import React from 'react';

export default function SurfaceFallback({ className = '', message = 'Loading…' }) {
  return (
    <div
      className={`flex items-center justify-center ${className}`.trim()}
      role="status"
      aria-live="polite"
    >
      <div className="rounded-lg border border-white/10 bg-white/70 px-4 py-3 text-sm text-gray-700 shadow-soft dark:bg-gray-900/70 dark:text-gray-200">
        {message}
      </div>
    </div>
  );
}
