/**
 * The service worker: lets the game be installed as an app and open without a connection.
 * - Pages, scripts, styles and data (same site only): the network first, so an update shows on the next load; the copy kept
 *   from the last visit only when the network fails (offline).
 * - Images, sounds and fonts on this site: the kept copy at once, refreshed in the background (so a changed image shows the
 *   visit after).
 * - Anything from another site (Firebase, gstatic, Google ads, Google Fonts) and anything that isn't a GET is never touched:
 *   the browser fetches it as if there were no service worker. So is the local relay (/__net/), a live stream.
 * The page (pwa.js) registers this and, once it is running, hands it the files the page loaded before it took over, so the
 * first visit is already enough to open offline next time.
 * Bump VERSION to drop everything kept (only needed if the kept copies themselves must go; updates don't need it).
 * strategyFor and the constants are exported for tests (tests/pwa.test.js).
 */
'use strict';

const VERSION = 'v1';
const PAGES = 'wh-pages-' + VERSION;
const MEDIA = 'wh-media-' + VERSION;
const MEDIA_MAX = 400;          // kept images/sounds; the oldest go first

const CODE_EXT = /\.(html?|js|mjs|css|json|webmanifest|txt|xml)$/i;
const MEDIA_EXT = /\.(png|jpe?g|webp|gif|svg|ico|avif|mp3|wav|ogg|m4a|woff2?|ttf)$/i;

// What to do with a request: 'network' (network first), 'media' (kept copy first) or null (leave it alone).
// url: absolute URL string; origin: this site's origin.
function strategyFor(url, method, origin) {
    if (method !== 'GET') return null;
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    if (u.origin !== origin) return null;
    if (u.pathname.startsWith('/__net/')) return null;           // the local relay's live stream and writes
    if (/\/sw\.js$/i.test(u.pathname)) return null;              // the browser checks this file for updates itself
    if (MEDIA_EXT.test(u.pathname)) return 'media';
    if (u.pathname.endsWith('/') || CODE_EXT.test(u.pathname) || !/\.[a-z0-9]{1,8}$/i.test(u.pathname)) return 'network';
    return null;
}

// Files the page loaded before this worker ran (pwa.js sends them): the same-site ones worth keeping, at most 300
function keepList(urls, origin) {
    const out = [];
    for (const raw of Array.isArray(urls) ? urls.slice(0, 300) : []) {
        if (typeof raw !== 'string') continue;
        const kind = strategyFor(raw, 'GET', origin);
        if (kind) out.push({ url: raw.split('#')[0], kind });
    }
    return out;
}

if (typeof module === 'object' && module.exports) {
    module.exports = { VERSION, PAGES, MEDIA, MEDIA_MAX, strategyFor, keepList };
} else {
    const ORIGIN = self.location.origin;

    self.addEventListener('install', () => { self.skipWaiting(); });
    self.addEventListener('activate', (ev) => {
        ev.waitUntil((async () => {
            const keep = new Set([PAGES, MEDIA]);
            for (const k of await caches.keys()) if (k.startsWith('wh-') && !keep.has(k)) await caches.delete(k);
            await self.clients.claim();
        })());
    });

    const okToKeep = (res) => res && res.ok && res.type === 'basic';

    async function trimMedia() {
        const c = await caches.open(MEDIA);
        const keys = await c.keys();
        for (let i = 0; i < keys.length - MEDIA_MAX; i++) await c.delete(keys[i]);
    }

    // Only when the network fails: never a kept copy because the network is slow, since a page from one version with scripts
    // from another could break the game
    async function fromNetworkFirst(req, isPage) {
        const cache = await caches.open(PAGES);
        try {
            const res = await fetch(req);
            if (okToKeep(res)) cache.put(req, res.clone()).catch(() => {});
            return res;
        } catch (e) {
            const hit = (await cache.match(req, { ignoreSearch: true })) || (isPage ? await cache.match('./index.html') : null);
            if (hit) return hit;
            throw e;
        }
    }

    async function fromMedia(req, ev) {
        const cache = await caches.open(MEDIA);
        const hit = await cache.match(req);
        const refresh = fetch(req).then((res) => {
            if (okToKeep(res)) return cache.put(req, res.clone()).then(trimMedia).then(() => res);
            return res;
        });
        if (hit) { ev.waitUntil(refresh.catch(() => {})); return hit; }
        return refresh;
    }

    self.addEventListener('fetch', (ev) => {
        const req = ev.request;
        const kind = strategyFor(req.url, req.method, ORIGIN);
        if (!kind) return;
        // a page asked for "only if cached" from another origin's context: leave it (Chrome throws on these)
        if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
        ev.respondWith(kind === 'media' ? fromMedia(req, ev) : fromNetworkFirst(req, req.mode === 'navigate'));
    });

    // pwa.js: { type: 'keep', urls: [...] }, the files the page loaded before this worker was in charge
    self.addEventListener('message', (ev) => {
        const d = ev.data;
        if (!d || d.type !== 'keep') return;
        ev.waitUntil((async () => {
            const pages = await caches.open(PAGES), media = await caches.open(MEDIA);
            for (const { url, kind } of keepList(d.urls, ORIGIN)) {
                const cache = kind === 'media' ? media : pages;
                if (await cache.match(url, { ignoreSearch: kind !== 'media' })) continue;
                try { const res = await fetch(url, { credentials: 'same-origin' }); if (okToKeep(res)) await cache.put(url, res); } catch (e) {}
            }
            await trimMedia();
        })());
    });
}
