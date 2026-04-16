/* ========================================
   Kuittiskanneri – Service Worker
   Cache-first for app shell, network-first
   for external resources
   ======================================== */

const CACHE_NAME = 'kuittiskanneri-v1';
const APP_SHELL = [
    './',
    './index.html',
    './css/styles.css',
    './js/app.js',
    './js/scanner.js',
    './js/share.js',
    './manifest.json',
    './icons/icon.svg',
    './icons/icon-192.png',
    './icons/icon-512.png',
];

const EXTERNAL_CACHE = [
    'https://docs.opencv.org/4.9.0/opencv.js',
];

// Install: cache app shell + OpenCV.js
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // Cache app shell (must succeed)
            const appShellPromise = cache.addAll(APP_SHELL);
            // Cache OpenCV.js separately (can fail – it's large)
            const externalPromise = Promise.allSettled(
                EXTERNAL_CACHE.map((url) =>
                    fetch(url).then((resp) => {
                        if (resp.ok) return cache.put(url, resp);
                    })
                )
            );
            return Promise.all([appShellPromise, externalPromise]);
        })
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

// Fetch: cache-first for app shell, network-first with cache fallback for others
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Only handle GET requests
    if (event.request.method !== 'GET') return;

    // For same-origin requests: cache-first
    if (url.origin === self.location.origin) {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                return cached || fetch(event.request).then((resp) => {
                    // Cache new resources dynamically
                    const clone = resp.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    return resp;
                });
            })
        );
        return;
    }

    // For OpenCV.js and other external: try cache first, then network
    if (EXTERNAL_CACHE.some((u) => event.request.url.startsWith(u))) {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                return cached || fetch(event.request).then((resp) => {
                    const clone = resp.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    return resp;
                });
            })
        );
    }
});
