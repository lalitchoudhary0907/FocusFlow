import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [
    {
      name: 'generate-service-worker',
      apply: 'build',
      closeBundle() {
        const distDir = path.resolve(__dirname, 'dist');
        const assetsDir = path.resolve(distDir, 'assets');

        if (!fs.existsSync(distDir)) {
          return;
        }

        // Collect all hashed CSS and JS assets in dist/assets
        let assetFiles = [];
        if (fs.existsSync(assetsDir)) {
          assetFiles = fs
            .readdirSync(assetsDir)
            .filter((file) => !file.startsWith('.'))
            .map((file) => `/assets/${file}`);
        }

        // App shell and precached static assets
        const precacheUrls = [
          '/',
          '/index.html',
          '/manifest.webmanifest',
          '/favicon-32x32.png',
          '/icon-192.png',
          '/icon-512.png',
          '/icon-maskable-512.png',
          '/icon-maskable-192.png',
          '/apple-touch-icon.png',
          ...assetFiles,
        ];

        const buildTimestamp = Date.now();
        const cacheName = `focusflow-v${buildTimestamp}`;

        const swContent = `/**
 * FocusFlow Service Worker (Production Only)
 * Precaches app shell, manifest, icons, and Vite build assets.
 * Cache: ${cacheName}
 */

const CACHE_NAME = '${cacheName}';
const PRECACHE_ASSETS = ${JSON.stringify(precacheUrls, null, 2)};

// 1. Install Phase: Precache app shell and actual build assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
});

// 2. Activate Phase: Clean up ONLY FocusFlow's own older caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key.startsWith('focusflow-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Message Phase: Client-directed skipWaiting when safe
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// 4. Fetch Phase: Offline-first app shell & cache-first for static assets
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Navigation requests (HTML document)
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch {
          const cache = await caches.open(CACHE_NAME);
          return (
            (await cache.match('/index.html', { ignoreVary: true })) ||
            (await cache.match('/', { ignoreVary: true })) ||
            (await caches.match('/index.html', { ignoreVary: true })) ||
            (await caches.match('/', { ignoreVary: true }))
          );
        }
      })()
    );
    return;
  }

  // Static assets & hashed chunks (CSS, JS, icons, manifest)
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // 1. Cache-first lookup with ignoreVary: true
      // Matches both Request object and exact pathname to prevent Vary header mismatches (e.g. Vary: Accept-Encoding)
      const cachedResponse =
        (await cache.match(req, { ignoreVary: true })) ||
        (await cache.match(url.pathname, { ignoreVary: true })) ||
        (await caches.match(req, { ignoreVary: true })) ||
        (await caches.match(url.pathname, { ignoreVary: true }));

      if (cachedResponse) {
        return cachedResponse;
      }

      // 2. Network fetch fallback
      try {
        const networkResponse = await fetch(req);
        if (networkResponse && networkResponse.status === 200) {
          const toCache = networkResponse.clone();
          cache.put(req, toCache);
        }
        return networkResponse;
      } catch (err) {
        // 3. Last-resort fallback for query strings / variations
        const fallback =
          (await cache.match(req, { ignoreVary: true, ignoreSearch: true })) ||
          (await cache.match(url.pathname, { ignoreVary: true, ignoreSearch: true })) ||
          (await caches.match(req, { ignoreVary: true, ignoreSearch: true })) ||
          (await caches.match(url.pathname, { ignoreVary: true, ignoreSearch: true }));

        if (fallback) {
          return fallback;
        }

        // Rethrow network error so browser handles normal network failure cleanly
        // rather than throwing Uncaught TypeError from returning undefined to respondWith
        throw err;
      }
    })()
  );
});
`;

        fs.writeFileSync(path.resolve(distDir, 'sw.js'), swContent, 'utf-8');
        console.log(`✓ Service Worker generated with ${precacheUrls.length} precached assets (${cacheName})`);
      },
    },
  ],
});
