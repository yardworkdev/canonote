import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';

const appRoute = {
  name: 'serve-app-route',
  // The notebook is served at `/app` in production by the vercel.json rewrite.
  // Dev and preview must behave the same way or the e2e suite tests a URL that
  // only exists on Vercel.
  handler(req) {
    const url = req.url || '';
    if (url === '/app' || url.startsWith('/app?') || (url.startsWith('/app/') && !url.startsWith('/app.html'))) {
      req.url = '/app.html';
    }
  },
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      appRoute.handler(req);
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, _res, next) => {
      appRoute.handler(req);
      next();
    });
  },
  // A static host with no rewrite rules — GitHub Pages, Cloudflare Pages, a bare
  // nginx root — resolves /app as a directory, not as app.html. Emit the same
  // document as dist/app/index.html so the notebook works there too, without
  // depending on vercel.json being the thing that makes the URL exist.
  closeBundle() {
    mkdirSync('dist/app', { recursive: true });
    writeFileSync('dist/app/index.html', readFileSync('dist/app.html'));
  },
};

export default defineConfig({
  plugins: [react(), appRoute],
  // Two surfaces, built together: the public front end at `/` (index.html) and
  // the notebook itself at `/app` (app.html). The marketing page is not the
  // tool, so it must not be the thing a visitor lands inside.
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app.html'),
      },
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          icons: ['lucide-react'],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
