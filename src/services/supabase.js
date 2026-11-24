/**
 * Supabase Integration Service
 *
 * This module provides the foundation for Supabase integration.
 * To activate, add your Supabase credentials to .env:
 *   VITE_SUPABASE_URL=https://your-project.supabase.co
 *   VITE_SUPABASE_ANON_KEY=your-anon-key
 *
 * Features:
 * - Authentication (email/password, magic link, OAuth)
 * - Cloud storage for notes (synced across devices)
 * - Real-time sync (optional)
 */

// Supabase client will be initialized lazily when credentials are available
import { readBrowserStorageValue, writeBrowserStorageValue } from './browser-storage';

let supabaseClient = null;
let supabaseClientPromise = null;
const SUPABASE_CLIENT_CACHE_KEY = Symbol.for('notes-editor.supabase.client-cache');

const getGlobalSupabaseClientCache = () => {
  if (typeof window === 'undefined') return null;
  if (!window[SUPABASE_CLIENT_CACHE_KEY]) {
    Object.defineProperty(window, SUPABASE_CLIENT_CACHE_KEY, {
      value: new Map(),
      configurable: false,
      enumerable: false,
      writable: false,
    });
  }
  return window[SUPABASE_CLIENT_CACHE_KEY];
};

const getSupabaseStorageKey = (url) => {
  try {
    const projectRef = new URL(url).hostname.split('.')[0];
    return projectRef ? `sb-${projectRef}-auth-token` : undefined;
  } catch {
    return undefined;
  }
};

/**
 * True when the build carries Supabase credentials at all.
 *
 * Credentials are not proof of a backend: a build can inherit VITE_SUPABASE_*
 * from a project whose backend no longer exists.
 */
export const hasSupabaseCredentials = () => {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return Boolean(url && key);
};

// null = not asked yet, true/false = what the reachability check found.
let backendReachable = null;

/**
 * Check if Supabase is configured *and* usable.
 *
 * A configured backend is not the same as a wanted one, and credentials are not
 * the same as a reachable one: the deployed instance carries VITE_SUPABASE_*
 * from a deleted project, and without this the app would sit behind a sign-in
 * screen that cannot succeed. `probeSupabaseBackend` settles that; until it has
 * run, credentials are taken at face value. `isLocalOnlyPreferred` still wins.
 */
export const isSupabaseConfigured = () => {
  if (!hasSupabaseCredentials()) return false;
  if (backendReachable === false) return false;
  return !isLocalOnlyPreferred();
};

const BACKEND_PROBE_TIMEOUT_MS = 2500;

/**
 * Ask the configured backend whether anything answers there at all.
 *
 * The request is `no-cors` on purpose: nothing is read from the response, so an
 * opaque answer still proves a host answered, while a deleted project fails the
 * request outright. No status or body means no CORS negotiation and no error in
 * the console for the user.
 */
export const probeSupabaseBackend = async () => {
  if (backendReachable !== null) return backendReachable;
  if (!hasSupabaseCredentials()) {
    backendReachable = false;
    return backendReachable;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_PROBE_TIMEOUT_MS);
  try {
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/health`, {
      mode: 'no-cors',
      signal: controller.signal,
    });
    backendReachable = true;
  } catch {
    backendReachable = false;
  } finally {
    clearTimeout(timer);
  }
  return backendReachable;
};

const LOCAL_ONLY_PREF_KEY = 'local-only-mode';

export const isLocalOnlyPreferred = () => readBrowserStorageValue(LOCAL_ONLY_PREF_KEY) === 'true';

export const setLocalOnlyPreferred = (localOnly) => {
  writeBrowserStorageValue(LOCAL_ONLY_PREF_KEY, localOnly ? 'true' : 'false');
};

/**
 * Get or create Supabase client
 * Returns null if not configured
 */
export const getSupabaseClient = async () => {
  if (!isSupabaseConfigured()) return null;

  // Synchronous fast-path: already initialized.
  if (supabaseClient) return supabaseClient;

  // Share the in-flight promise so concurrent callers don't each call createClient —
  // that would trigger "Multiple GoTrueClient instances" warnings from the Supabase library.
  if (!supabaseClientPromise) {
    supabaseClientPromise = (async () => {
      const url = import.meta.env.VITE_SUPABASE_URL;
      const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const clientCache = getGlobalSupabaseClientCache();
      const cacheKey = url || 'default';

      if (clientCache?.has(cacheKey)) {
        supabaseClient = clientCache.get(cacheKey);
        return supabaseClient;
      }

      try {
        const { createClient } = await import('@supabase/supabase-js');
        supabaseClient = createClient(url, key, {
          auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
            storageKey: getSupabaseStorageKey(url),
          },
        });
        clientCache?.set(cacheKey, supabaseClient);
        return supabaseClient;
      } catch (error) {
        supabaseClientPromise = null;
        console.error('Failed to initialize Supabase:', error);
        return null;
      }
    })();
  }

  return supabaseClientPromise;
};

/**
 * Supabase Auth Service
 */
export const supabaseAuth = {
  /**
   * Sign up with email and password
   */
  async signUp(email, password) {
    const client = await getSupabaseClient();
    if (!client) throw new Error('Supabase not configured');

    const { data, error } = await client.auth.signUp({
      email,
      password,
    });

    if (error) throw error;
    return data;
  },

  /**
   * Sign in with email and password
   */
  async signIn(email, password) {
    const client = await getSupabaseClient();
    if (!client) throw new Error('Supabase not configured');

    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
    return data;
  },

  /**
   * Sign in with magic link (passwordless)
   */
  async signInWithMagicLink(email) {
    const client = await getSupabaseClient();
    if (!client) throw new Error('Supabase not configured');

    const { data, error } = await client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    if (error) throw error;
    return data;
  },

  /**
   * Sign in with OAuth provider (Google, GitHub, etc.)
   */
  async signInWithOAuth(provider) {
    const client = await getSupabaseClient();
    if (!client) throw new Error('Supabase not configured');

    const { data, error } = await client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) throw error;
    return data;
  },

  /**
   * Sign in anonymously (requires "Enable anonymous sign-ins" in Supabase dashboard)
   */
  async signInAnonymously() {
    const client = await getSupabaseClient();
    if (!client) throw new Error('Supabase not configured');

    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw error;
    return data;
  },

  /**
   * Sign out
   */
  async signOut() {
    const client = await getSupabaseClient();
    if (!client) throw new Error('Supabase not configured');

    const { error } = await client.auth.signOut();
    if (error) throw error;
  },

  /**
   * Get current session
   */
  async getSession() {
    const client = await getSupabaseClient();
    if (!client) return null;

    const { data, error } = await client.auth.getSession();
    if (error) {
      console.error('Failed to get session:', error);
      return null;
    }
    return data.session;
  },

  /**
   * Get current user
   */
  async getUser() {
    const client = await getSupabaseClient();
    if (!client) return null;

    const { data, error } = await client.auth.getUser();
    if (error) {
      console.error('Failed to get user:', error);
      return null;
    }
    return data.user;
  },

  /**
   * Subscribe to auth state changes
   */
  async onAuthStateChange(callback) {
    const client = await getSupabaseClient();
    if (!client) return null;

    const { data } = client.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });

    return data.subscription;
  },

  /**
   * Reset password
   */
  async resetPassword(email) {
    const client = await getSupabaseClient();
    if (!client) throw new Error('Supabase not configured');

    // The recovery link comes back to the app itself. There is no /reset-password
    // route: the build has three surfaces (/ , /app, /demo) and nothing else, so
    // the link used to land on a 404. /app boots, sees PASSWORD_RECOVERY in the URL
    // and asks for a new password there.
    const { data, error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/app`,
    });

    if (error) throw error;
    return data;
  },

  /**
   * Update password
   */
  async updatePassword(newPassword) {
    const client = await getSupabaseClient();
    if (!client) throw new Error('Supabase not configured');

    const { data, error } = await client.auth.updateUser({
      password: newPassword,
    });

    if (error) throw error;
    return data;
  },
};

export default {
  isConfigured: isSupabaseConfigured,
  getClient: getSupabaseClient,
  auth: supabaseAuth,
};
