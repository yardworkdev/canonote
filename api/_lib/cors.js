/**
 * One CORS policy for both APIs.
 *
 * The two handlers each had their own hardcoded allowlist, and they disagreed:
 * /api/notes trusted `notes-editor-two.vercel.app` while /api/agent trusted
 * `notes-editor.vercel.app`, neither read the deployments the app actually runs
 * on, and an origin that was not on the list was answered with *another* origin
 * — which the browser then blocks, so the failure looked like "CORS is broken in
 * production, works locally".
 *
 * The rule now: echo the origin only when it is allowed. When it is not, send no
 * CORS header at all, which is the standard way to say "not for you" and leaves
 * the browser's own error intact instead of confusing it with a mismatch.
 */

const STATIC_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'https://notes-editor.vercel.app',
  'https://notes-editor-two.vercel.app',
  'https://canonote.vercel.app',
];

/** Vercel gives every deployment its own hostname; the app is on all of them. */
const vercelOrigins = () => {
  const urls = [
    process.env.VERCEL_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_BRANCH_URL,
  ].filter(Boolean);
  return urls.map((url) => `https://${String(url).replace(/^https?:\/\//, '')}`);
};

/** `CORS_ALLOWLIST` is a comma-separated list, for anything not covered above. */
const configuredOrigins = () =>
  (process.env.CORS_ALLOWLIST || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

export const allowedOrigins = () =>
  Array.from(new Set([...configuredOrigins(), ...vercelOrigins(), ...STATIC_ORIGINS]));

export const applyCors = (req, res, { headers } = /** @type {{ headers?: string }} */ ({})) => {
  const origin = req.headers?.origin;
  const allowed = Boolean(origin) && allowedOrigins().includes(origin);
  res.setHeader('Vary', 'Origin');
  if (allowed) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    headers || 'Content-Type, Authorization, If-Match'
  );
};
