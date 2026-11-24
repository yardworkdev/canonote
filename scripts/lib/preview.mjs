/**
 * A preview server a check can own.
 *
 * Every browser check in this repo needs a built app on a port. Checks used to
 * assume one was already running, which made them fail on a clean checkout with
 * ERR_CONNECTION_REFUSED — and a check that cannot run proves nothing.
 *
 * `ensurePreview` builds if the output is missing, starts `vite preview`, waits
 * until it answers, and hands back a `stop` function. Two details cost a pass
 * each and are pinned here:
 *
 * - The server must be unref'd, or the event loop keeps the script alive after
 *   its own PASS and it hangs until the timeout.
 * - It must be spawned as the vite binary, not through `npx`: killing the npx
 *   wrapper leaves the server holding the port, and the next run then meets it.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const answers = async (url) => {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
};

const waitFor = async (url, deadlineMs) => {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (await answers(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
};

/**
 * @param {{ port?: number, outDir?: string, env?: Record<string,string>, base?: string }} [options]
 * @returns {Promise<{ base: string, stop: () => void }>}
 */
export async function ensurePreview({ port = 8187, outDir = 'dist', env = {}, base } = {}) {
  const origin = base || `http://127.0.0.1:${port}`;
  const probe = `${origin}/app/`;

  if (await answers(probe)) return { base: origin, stop: () => {} };

  if (!fs.existsSync(path.join(outDir, 'index.html'))) {
    // `dist` is the shipped build; any other outDir is a build made for this
    // check alone (a device-only build needs the Supabase env blanked, and
    // VITE_ vars are baked in at build time).
    const build =
      outDir === 'dist'
        ? spawnSync('npm', ['run', 'build'], { stdio: 'inherit', env: { ...process.env, ...env } })
        : spawnSync(
            process.execPath,
            ['node_modules/vite/bin/vite.js', 'build', '--outDir', outDir, '--emptyOutDir'],
            { stdio: 'inherit', env: { ...process.env, ...env } }
          );
    if (build.status !== 0) {
      throw new Error(`the build did not finish, so there is nothing in ${outDir} to serve`);
    }
  }

  const server = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--outDir', outDir],
    { stdio: 'ignore', env: { ...process.env, ...env } }
  );
  server.unref();
  const stop = () => server.kill('SIGTERM');
  process.on('exit', stop);

  if (!(await waitFor(probe, 30000))) {
    stop();
    throw new Error(`no preview server came up on ${origin} serving ${outDir}`);
  }
  return { base: origin, stop };
}
