import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './src/App.jsx';
import { initializeStorage } from './src/services/storage-adapter';
import {
  createLocalStorageAdapter,
  freezeStorageAdapter,
  toCompatibleStorageAdapter,
} from './src/services/browser-storage';

const localStorageAdapter = createLocalStorageAdapter();
let storageBackend =
  toCompatibleStorageAdapter(localStorageAdapter) || freezeStorageAdapter(localStorageAdapter);

Object.defineProperty(window, 'storage', {
  configurable: false,
  enumerable: false,
  get() {
    return storageBackend;
  },
  set(value) {
    const normalized = toCompatibleStorageAdapter(value);
    if (!normalized) {
      console.warn('Ignoring invalid window.storage assignment');
      return;
    }
    storageBackend = normalized;
  },
});

window.storage = localStorageAdapter;

async function bootstrap() {
  try {
    const storageAdapter = await initializeStorage();
    window.storage = storageAdapter;
  } catch (error) {
    console.warn('Falling back to localStorage adapter:', error);
    window.storage = localStorageAdapter;
  }

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );

  // The notebook is in this browser, so opening it must not need the network.
  // Production only: a worker in dev would serve yesterday's shell over today's
  // code and hide every change until the cache was cleared.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.warn('Offline shell unavailable:', error);
      });
    };
    // bootstrap() is async, so `load` may already have fired by the time we get
    // here; waiting for it again would mean the worker is never registered.
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }
}

bootstrap();
