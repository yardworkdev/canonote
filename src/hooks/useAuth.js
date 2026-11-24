import { useCallback, useEffect, useMemo, useState } from 'react';
import { hasSupabaseCredentials, isSupabaseConfigured, probeSupabaseBackend, supabaseAuth } from '../services/supabase';

const isLocalAuthBypassEnabled = () =>
  import.meta.env.DEV &&
  String(import.meta.env.VITE_AUTH_LOCAL_BYPASS || '').toLowerCase() === 'true';

// Without a configured cloud backend the app is a local notebook: it opens
// straight into the editor instead of demanding a sign-in it cannot perform.
// This is a supported mode, not an error. `isLocal` marks the session so the
// rest of the app can tell a local notebook from a signed-in cloud account.
export const LOCAL_USER = { id: 'local', username: 'Local', isLocal: true, isAnonymous: false };

const userFromSession = (session) => {
  const sessionUser = session?.user;
  if (!sessionUser?.id) return null;
  return {
    id: sessionUser.id,
    username: sessionUser.email || sessionUser.phone || sessionUser.id,
    isAnonymous: Boolean(sessionUser.is_anonymous),
  };
};

const expiresAtFromSession = (session) =>
  session?.expires_at ? Number(session.expires_at) * 1000 : null;

const classifyAuthError = (error) => {
  const message = String(error?.message || 'Authentication failed.');
  if (/invalid login credentials/i.test(message)) return 'Invalid email or password.';
  if (/email not confirmed/i.test(message)) return 'Confirm your email before signing in.';
  if (/rate limit/i.test(message)) return 'Too many attempts. Wait and try again.';
  return message;
};

export const useAuth = (_storage) => {
  const [user, setUser] = useState(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authError, setAuthError] = useState('');
  const [authForm, setAuthForm] = useState({ username: '', password: '' });
  const [resetPasswordForm, setResetPasswordForm] = useState({
    password: '',
    confirmPassword: '',
  });
  const [isLoading, setIsLoading] = useState(true);

  // The policy follows the configuration: a configured backend means real
  // accounts; no backend means this is a local notebook and no sign-in exists.
  const authPolicy = isSupabaseConfigured() ? 'strict-supabase' : 'local';

  const adoptSession = useCallback((session) => {
    setUser(userFromSession(session));
    setSessionExpiresAt(expiresAtFromSession(session));
    setSessionExpired(false);
  }, []);

  const authenticate = useCallback(async () => {
    const email = authForm.username.trim().toLowerCase();
    const password = authForm.password;
    setAuthError('');

    if (!email || !password) {
      setAuthError('Enter your email and password.');
      return false;
    }
    if (!isSupabaseConfigured()) {
      setAuthError('Supabase is not configured.');
      return false;
    }

    try {
      const data =
        authMode === 'signup'
          ? await supabaseAuth.signUp(email, password)
          : await supabaseAuth.signIn(email, password);
      const session = await supabaseAuth.getSession();
      if (!session?.user && data?.user) {
        setAuthError('Check your email to confirm the account, then sign in.');
        return false;
      }
      adoptSession(session);
      setAuthForm({ username: '', password: '' });
      return Boolean(session?.user);
    } catch (error) {
      setAuthError(classifyAuthError(error));
      return false;
    }
  }, [adoptSession, authForm, authMode]);

  const requestPasswordReset = useCallback(async () => {
    const email = authForm.username.trim().toLowerCase();
    if (!email) {
      setAuthError('Enter your email first.');
      return false;
    }
    try {
      await supabaseAuth.resetPassword(email);
      setAuthError('Password reset email sent.');
      return true;
    } catch (error) {
      setAuthError(classifyAuthError(error));
      return false;
    }
  }, [authForm.username]);

  const completePasswordReset = useCallback(async () => {
    const { password, confirmPassword } = resetPasswordForm;
    if (password.length < 8) {
      setAuthError('Password must be at least 8 characters.');
      return false;
    }
    if (password !== confirmPassword) {
      setAuthError('Passwords do not match.');
      return false;
    }
    try {
      await supabaseAuth.updatePassword(password);
      // The recovery link signed this browser in. Ending that session means the
      // new password is proven once, on the sign-in form, instead of leaving a
      // session nobody asked for.
      await supabaseAuth.signOut().catch(() => {});
      setUser(null);
      setResetPasswordForm({ password: '', confirmPassword: '' });
      setAuthMode('login');
      setAuthError('Password updated. Sign in with the new password.');
      return true;
    } catch (error) {
      setAuthError(classifyAuthError(error));
      return false;
    }
  }, [resetPasswordForm]);

  const logout = useCallback(
    async (expired = false) => {
      try {
        if (isSupabaseConfigured()) await supabaseAuth.signOut();
      } catch (error) {
        console.warn('Supabase sign out failed:', error);
      } finally {
        // In local-only mode there is nothing to sign out of: keep the local
        // notebook open rather than dropping the user at an unusable login.
        setUser(isSupabaseConfigured() ? null : LOCAL_USER);
        setSessionExpiresAt(null);
        setSessionExpired(Boolean(expired));
        setAuthMode('login');
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    let subscription = null;

    const initialize = async () => {
      if (isLocalAuthBypassEnabled()) {
        if (!cancelled) {
          setUser({ id: 'local-dev-user', username: 'local-dev', isAnonymous: false });
          setIsLoading(false);
        }
        return;
      }
      // Credentials in the build do not make a backend. A build can inherit
      // VITE_SUPABASE_* from a project that no longer exists — the deployed
      // instance does — and would then gate the notebook behind a sign-in that
      // cannot succeed. Ask once, then follow the answer.
      if (hasSupabaseCredentials()) {
        await probeSupabaseBackend();
        if (cancelled) return;
      }
      if (!isSupabaseConfigured()) {
        // Local-only mode: no auth is possible and none is required.
        if (!cancelled) {
          setUser(LOCAL_USER);
          setAuthError('');
          setIsLoading(false);
        }
        return;
      }

      // Read the hash before anything awaits: the client consumes it while it
      // initialises, and the PASSWORD_RECOVERY event can fire before a listener
      // exists. A recovery link therefore announced itself to nobody, the session
      // was adopted, and the notebook opened with no way to set a password.
      const arrivedFromRecoveryLink = /(^|[#&?])type=recovery\b/.test(window.location.hash);

      try {
        const session = await supabaseAuth.getSession();
        if (cancelled) return;
        if (arrivedFromRecoveryLink) setAuthMode('reset');
        adoptSession(session);
        subscription = await supabaseAuth.onAuthStateChange((event, nextSession) => {
          if (cancelled) return;
          if (event === 'PASSWORD_RECOVERY') setAuthMode('reset');
          adoptSession(nextSession);
        });
      } catch (error) {
        if (!cancelled) setAuthError(classifyAuthError(error));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void initialize();
    return () => {
      cancelled = true;
      subscription?.unsubscribe?.();
    };
  }, [adoptSession]);

  const authDiagnostics = useMemo(
    () => ({
      policy: authPolicy,
      supabase: {
        attempted: !isLoading,
        status: user ? 'verified' : 'not_attempted',
        detail: user ? 'Supabase session active.' : authError,
      },
    }),
    [authError, isLoading, user]
  );

  return {
    user,
    sessionExpiresAt,
    sessionExpired,
    isLoading,
    authMode,
    setAuthMode,
    authPolicy,
    authError,
    authForm,
    setAuthForm,
    resetPasswordForm,
    setResetPasswordForm,
    authDiagnostics,
    authenticate,
    signIn: authenticate,
    signUp: authenticate,
    signOut: logout,
    changePassword: completePasswordReset,
    requestPasswordReset,
    completePasswordReset,
    logout,
  };
};
