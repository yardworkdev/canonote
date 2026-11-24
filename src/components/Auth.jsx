import { BookOpen, KeyRound, Loader2 } from 'lucide-react';

export default function Auth({
  sessionExpired = false,
  authMode = 'login',
  setAuthMode,
  authError = '',
  authForm,
  setAuthForm,
  resetPasswordForm,
  setResetPasswordForm,
  onAuthenticate,
  onResetPassword,
  onCompletePasswordReset,
  onUseLocally,
}) {
  const isSignup = authMode === 'signup';
  const isReset = authMode === 'reset';
  const isSubmitting = authMode === 'submitting';

  const submitAuth = async (event) => {
    event.preventDefault();
    await onAuthenticate?.();
  };

  const submitReset = async (event) => {
    event.preventDefault();
    await onCompletePasswordReset?.();
  };

  return (
    <main className="min-h-screen bg-animated-gradient-dark px-4 py-8 text-white flex items-center justify-center">
      <section className="w-full max-w-md rounded-lg border border-white/10 bg-neutral-950/80 p-6 shadow-lg shadow-black/30 sm:p-8">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white/5">
            <BookOpen className="h-5 w-5 text-gray-300" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm text-gray-400">canonote</p>
            <h1 className="text-xl font-semibold tracking-tight">Unlock your workspace</h1>
          </div>
        </div>

        {sessionExpired && (
          <p className="mb-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-300">
            Your session expired. Sign in again to continue.
          </p>
        )}
        {authError && (
          <p className="mb-4 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-100" role="alert">
            {authError}
          </p>
        )}

        {isReset ? (
          <form className="space-y-4" onSubmit={submitReset}>
            <label className="block text-sm text-gray-300">
              New password
              <input
                type="password"
                autoComplete="new-password"
                value={resetPasswordForm.password}
                onChange={(event) =>
                  setResetPasswordForm({ ...resetPasswordForm, password: event.target.value })
                }
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 text-white outline-none focus-visible:border-gray-400/60 focus-visible:ring-2 focus-visible:ring-gray-400/15"
              />
            </label>
            <label className="block text-sm text-gray-300">
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                value={resetPasswordForm.confirmPassword}
                onChange={(event) =>
                  setResetPasswordForm({
                    ...resetPasswordForm,
                    confirmPassword: event.target.value,
                  })
                }
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 text-white outline-none focus-visible:border-gray-400/60 focus-visible:ring-2 focus-visible:ring-gray-400/15"
              />
            </label>
            <button className="w-full rounded-lg bg-gray-100 px-4 py-2.5 font-medium text-neutral-950 hover:bg-white">
              Update password
            </button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={submitAuth}>
            <label className="block text-sm text-gray-300">
              Email
              <input
                type="email"
                autoComplete="email"
                value={authForm.username}
                onChange={(event) => setAuthForm({ ...authForm, username: event.target.value })}
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 text-white outline-none focus-visible:border-gray-400/60 focus-visible:ring-2 focus-visible:ring-gray-400/15"
                required
              />
            </label>
            <label className="block text-sm text-gray-300">
              Password
              <input
                type="password"
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                value={authForm.password}
                onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 text-white outline-none focus-visible:border-gray-400/60 focus-visible:ring-2 focus-visible:ring-gray-400/15"
                minLength={8}
                required
              />
            </label>
            <button
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-4 py-2.5 font-medium text-neutral-950 hover:bg-white disabled:opacity-60"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {isSignup ? 'Create account' : 'Sign in'}
            </button>
            {!isSignup && (
              <button
                type="button"
                onClick={onResetPassword}
                className="w-full text-sm text-gray-400 hover:text-white"
              >
                Send password reset email
              </button>
            )}
          </form>
        )}

        {!isReset && (
          <div className="mt-6 border-t border-white/10 pt-5 text-center text-sm text-gray-400">
            {isSignup ? 'Already have an account?' : 'Need an account?'}{' '}
            <button
              type="button"
              onClick={() => setAuthMode(isSignup ? 'login' : 'signup')}
              className="font-medium text-gray-200 underline decoration-dotted underline-offset-4 hover:text-white"
            >
              {isSignup ? 'Sign in' : 'Create one'}
            </button>
          </div>
        )}

        {onUseLocally && (
          <div className="mt-4 text-center text-xs text-gray-500">
            <button
              type="button"
              onClick={onUseLocally}
              className="underline decoration-dotted underline-offset-4 hover:text-gray-300"
            >
              Use this device only — no account, nothing leaves it
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
