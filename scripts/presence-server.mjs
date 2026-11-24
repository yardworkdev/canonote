#!/usr/bin/env node
/**
 * One API process, for the gate that needs two of them.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/presence-server.mjs 8121
 *
 * Vercel gives each serverless function its own process and its own memory; a
 * test on one process cannot see the difference. This mounts the two real
 * handlers in a plain http server so `check-presence-shared.mjs` can start two of
 * them and ask the second what the first was told.
 */
import http from 'node:http';
import { handleAgent } from '../api/_lib/agent-handler.js';
import { handleNotes } from '../api/_lib/notes-handler.js';

const PORT = Number(process.argv[2] || 8121);

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const segments = url.pathname.split('/').filter(Boolean);

  const answer = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      res.writeHead(this.statusCode, { 'Content-Type': 'application/json', ...this.headers });
      res.end(JSON.stringify(payload));
      return this;
    },
    end(body = '') {
      res.writeHead(this.statusCode, this.headers);
      res.end(body);
      return this;
    },
  };

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  const body = await readBody(req);
  const request = {
    method: req.method,
    url: req.url,
    headers: req.headers,
    body,
    query: {},
  };

  // Vercel rewrites hand the catch-all route its path as query.path; mount the
  // same way so the handlers route exactly as they do in production.
  if (segments[0] === 'api' && segments[1] === 'agent') {
    request.query = { path: segments.slice(2) };
    return handleAgent(request, answer);
  }
  if (segments[0] === 'api' && segments[1] === 'notes') {
    request.query = { path: segments.slice(2) };
    return handleNotes(request, answer);
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, error: 'no route' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`listening ${PORT}`);
});
