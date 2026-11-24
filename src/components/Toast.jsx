import React, { useEffect, useRef } from 'react';
import { Check, X, AlertCircle, Info, Loader2 } from 'lucide-react';

export default function Toast({ message, type = 'info', onClose, duration = 5000 }) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        onCloseRef.current?.();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration]);

  const icons = {
    success: Check,
    error: X,
    warning: AlertCircle,
    info: Info,
    loading: Loader2,
  };

  const Icon = icons[type] || Info;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-soft-lg border motion-safe:animate-in motion-safe:fade-in-up ${
        type === 'success'
          ? 'bg-green-50/95 dark:bg-green-900/20 border-green-200 dark:border-green-800/50 text-green-800 dark:text-green-200'
          : type === 'error'
            ? 'bg-red-50/95 dark:bg-red-900/20 border-red-200 dark:border-red-800/50 text-red-800 dark:text-red-200'
            : type === 'warning'
              ? 'bg-yellow-50/95 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800/50 text-yellow-800 dark:text-yellow-200'
              : 'bg-slate-50/95 dark:bg-slate-900/20 border-slate-200 dark:border-slate-800/50 text-slate-800 dark:text-slate-200'
      }`}
      role="alert"
    >
      <Icon
        className={`w-5 h-5 flex-shrink-0 ${
          type === 'loading'
            ? 'motion-safe:animate-spin'
            : type === 'success'
              ? 'motion-safe:animate-checkmark'
              : ''
        }`}
        strokeWidth={1.5}
      />
      <span className="flex-1 text-sm font-medium">{message}</span>
      <button
        onClick={onClose}
        className={`p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors`}
        aria-label="Close notification"
      >
        <X className="w-4 h-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}

export function ToastContainer({ toasts, onRemove }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          onClose={() => onRemove(toast.id)}
          duration={toast.duration}
        />
      ))}
    </div>
  );
}
