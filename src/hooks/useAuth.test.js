import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/supabase', () => ({
  isSupabaseConfigured: () => true,
  hasSupabaseCredentials: () => true,
  probeSupabaseBackend: vi.fn().mockResolvedValue(true),
  supabaseAuth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
  },
}));

import { useAuth } from './useAuth';
import { supabaseAuth } from '../services/supabase';

describe('useAuth', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(supabaseAuth, 'onAuthStateChange').mockResolvedValue({ unsubscribe: vi.fn() });
  });

  it('adopts the authoritative Supabase session', async () => {
    vi.spyOn(supabaseAuth, 'getSession').mockResolvedValue({
      access_token: 'token',
      expires_at: 2_000_000_000,
      user: { id: 'user-1', email: 'writer@example.com' },
    });

    const { result } = renderHook(() => useAuth(null));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).toEqual({
      id: 'user-1',
      username: 'writer@example.com',
      isAnonymous: false,
    });
  });

  it('signs out through Supabase and clears local identity state', async () => {
    vi.spyOn(supabaseAuth, 'getSession').mockResolvedValue({
      user: { id: 'user-1', email: 'writer@example.com' },
    });
    const signOut = vi.spyOn(supabaseAuth, 'signOut').mockResolvedValue(undefined);
    const { result } = renderHook(() => useAuth(null));
    await waitFor(() => expect(result.current.user?.id).toBe('user-1'));

    await act(async () => result.current.logout());

    expect(signOut).toHaveBeenCalledOnce();
    expect(result.current.user).toBeNull();
  });

  it('userFromSession returns null for session with no user', async () => {
    vi.spyOn(supabaseAuth, 'getSession').mockResolvedValue(null);

    const { result } = renderHook(() => useAuth(null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).toBeNull();
  });

  it('userFromSession uses id as username when no email/phone', async () => {
    vi.spyOn(supabaseAuth, 'getSession').mockResolvedValue({
      user: { id: 'user-no-email' },
    });

    const { result } = renderHook(() => useAuth(null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user.username).toBe('user-no-email');
  });

  it('classifyAuthError returns friendly message for invalid credentials', async () => {
    vi.spyOn(supabaseAuth, 'getSession').mockResolvedValue(null);
    vi.spyOn(supabaseAuth, 'signIn').mockRejectedValue(new Error('Invalid login credentials'));

    const { result } = renderHook(() => useAuth(null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Set form data
    act(() => result.current.setAuthForm({ username: 'test@test.com', password: 'wrong' }));
    await act(async () => result.current.authenticate());

    expect(result.current.authError).toBe('Invalid email or password.');
  });

  it('classifyAuthError returns friendly message for rate limit', async () => {
    vi.spyOn(supabaseAuth, 'getSession').mockResolvedValue(null);
    vi.spyOn(supabaseAuth, 'signIn').mockRejectedValue(new Error('Rate limit exceeded'));

    const { result } = renderHook(() => useAuth(null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setAuthForm({ username: 'test@test.com', password: 'pass' }));
    await act(async () => result.current.authenticate());

    expect(result.current.authError).toBe('Too many attempts. Wait and try again.');
  });

  it('authenticate returns false when email is empty', async () => {
    vi.spyOn(supabaseAuth, 'getSession').mockResolvedValue(null);

    const { result } = renderHook(() => useAuth(null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setAuthForm({ username: '', password: 'pass' }));
    let returnValue;
    await act(async () => { returnValue = await result.current.authenticate(); });

    expect(returnValue).toBe(false);
    expect(result.current.authError).toBe('Enter your email and password.');
  });
});
