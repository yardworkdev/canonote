#!/usr/bin/env node
/**
 * Which Chromium the checks drive.
 *
 * Playwright brings its own browser, so the default answer is "the one
 * Playwright installed". A check only needs to name a binary when the machine
 * keeps it somewhere else — a container image, a system Chrome, a browser
 * cache shared between projects. That was a hardcoded path to one machine's
 * cache for a while, which made every browser check fail in a clone with
 * "browserType.launch: Executable doesn't exist".
 *
 *   CHROME_BIN               an explicit Chromium/Chrome binary
 *   PLAYWRIGHT_CHROMIUM_PATH the older name, still honoured
 *   CHROME_PATH              what the offline checks always used
 *
 * With none of them set the launch is left alone, and Playwright resolves its
 * own browser. `--no-sandbox` is added only when running as root, because
 * Chromium's sandbox cannot start there and the flag is a security downgrade
 * everywhere else.
 */
export const browserExecutable = () =>
  process.env.CHROME_BIN ||
  process.env.PLAYWRIGHT_CHROMIUM_PATH ||
  process.env.CHROME_PATH ||
  undefined;

const runningAsRoot = () => typeof process.getuid === 'function' && process.getuid() === 0;

/** Options for `chromium.launch()`. Extra options win. */
export const launchOptions = (extra = {}) => ({
  ...(browserExecutable() ? { executablePath: browserExecutable() } : {}),
  ...(runningAsRoot() ? { args: ['--no-sandbox'] } : {}),
  ...extra,
});
