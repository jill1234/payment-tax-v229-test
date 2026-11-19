/* V2.2.9 isolated test: app-shell only; user data remains in IndexedDB. */
'use strict';
const CACHE_NAME = 'payment-tax-v229-isolated-shell-4';
const CACHE_PREFIX = 'payment-tax-v229-isolated-shell-';
const APP_FILES = ['./', './index.html', './app.js', './style.css', './manifest.webmanifest', './icon-512.png'];
const APP_URLS = APP_FILES.map(path => new URL(path, self.registration.scope).href);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Installation fails if a required file cannot be cached: no false offline-ready state.
    await cache.addAll(APP_URLS.map(url => new Request(url, {cache:'reload'})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  const isNavigation = request.mode === 'navigate';
  const appAsset = APP_URLS.includes(url.origin + url.pathname);
  if (!isNavigation && !appAsset) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (isNavigation) {
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(new URL('./index.html', self.registration.scope).href, response.clone());
        return response;
      } catch (_) {
        return await cache.match(new URL('./index.html', self.registration.scope).href) || Response.error();
      }
    }
    const cached = await cache.match(new URL(url.origin + url.pathname));
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(new URL(url.origin + url.pathname), response.clone());
      return response;
    } catch (_) { return Response.error(); }
  })());
});
