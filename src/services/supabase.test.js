import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Each case needs a fresh module: the reachability answer is remembered in
// module state on purpose (one probe per page load).
const loadService = async () => {
  vi.resetModules();
  return import('./supabase');
};

const stubCredentials = (url = 'https://alive-project.supabase.co') => {
  vi.stubEnv('VITE_SUPABASE_URL', url);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
};

describe('supabase backend detection', () => {
  beforeEach(() => {
    window.localStorage.getItem.mockReturnValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reports no backend when the build carries no credentials', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { hasSupabaseCredentials, isSupabaseConfigured, probeSupabaseBackend } =
      await loadService();

    expect(hasSupabaseCredentials()).toBe(false);
    expect(isSupabaseConfigured()).toBe(false);
    await expect(probeSupabaseBackend()).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('takes credentials at face value until the probe has run', async () => {
    stubCredentials();
    const { isSupabaseConfigured } = await loadService();

    expect(isSupabaseConfigured()).toBe(true);
  });

  it('keeps a backend that answers', async () => {
    stubCredentials();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true });
    const { isSupabaseConfigured, probeSupabaseBackend } = await loadService();

    await expect(probeSupabaseBackend()).resolves.toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://alive-project.supabase.co/auth/v1/health',
      expect.objectContaining({ mode: 'no-cors' })
    );
    expect(isSupabaseConfigured()).toBe(true);
  });

  it('drops a backend that no longer exists, so the notebook is not gated', async () => {
    // The deployed instance hits exactly this: credentials inherited from a
    // deleted Supabase project, whose host does not resolve.
    stubCredentials('https://deleted-project.invalid');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const { isSupabaseConfigured, probeSupabaseBackend } = await loadService();

    await expect(probeSupabaseBackend()).resolves.toBe(false);
    expect(isSupabaseConfigured()).toBe(false);
  });

  it('probes the backend once per page load', async () => {
    stubCredentials();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true });
    const { probeSupabaseBackend } = await loadService();

    await probeSupabaseBackend();
    await probeSupabaseBackend();

    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('still honours the local-only pin on a reachable backend', async () => {
    stubCredentials();
    window.localStorage.getItem.mockReturnValue('true');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true });
    const { isSupabaseConfigured, probeSupabaseBackend } = await loadService();

    await expect(probeSupabaseBackend()).resolves.toBe(true);
    expect(isSupabaseConfigured()).toBe(false);
  });
});
