import {
  readBrowserStorageJson,
  removeBrowserStorageValue,
  writeBrowserStorageJson,
} from '../services/browser-storage';

const LOG_KEY = 'notes-save-debug-log';
const MAX_LOG_ENTRIES = 500;

const isObject = (value) => value && typeof value === 'object';

const redactKey = (key) => {
  const normalized = String(key || '').toLowerCase();
  return (
    normalized.includes('content') ||
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('key')
  );
};

const sanitize = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }

  if (isObject(value)) {
    return Object.entries(value).reduce((acc, [key, item]) => {
      acc[key] = redactKey(key) ? '[REDACTED]' : sanitize(item);
      return acc;
    }, {});
  }

  if (typeof value === 'string' && value.length > 300) {
    return `${value.slice(0, 300)}...[truncated]`;
  }

  return value;
};

const readLogs = () => {
  const parsed = readBrowserStorageJson(LOG_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
};

const writeLogs = (logs) => {
  writeBrowserStorageJson(LOG_KEY, logs.slice(-MAX_LOG_ENTRIES));
};

export const getSaveDebugLogs = () => readLogs();

export const clearSaveDebugLogs = () => {
  removeBrowserStorageValue(LOG_KEY);
};

export const downloadSaveDebugLogs = () => {
  const logs = getSaveDebugLogs();
  const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.href = url;
  link.download = `notes-save-debug-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const logSaveDebug = (event, payload = {}) => {
  const entry = {
    ts: new Date().toISOString(),
    event,
    payload: sanitize(payload),
  };

  const current = readLogs();
  current.push(entry);
  writeLogs(current);

  if (import.meta.env?.DEV && import.meta.env?.MODE !== 'test') {
    console.info('[save-debug]', entry);
  }
  return entry;
};
