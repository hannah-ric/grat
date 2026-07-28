/* Blueprint Buddy — offline app shell (audit finding V-06).
 *
 * NOT A BUNDLE MODULE. This file is never inlined into dist/index.html and it
 * never attaches anything to BB. build.js stamps it and writes it out as the
 * sibling file dist/sw.js, because a service worker has to be served as its
 * own same-origin script. Do NOT add it to the {{JS_*}} chain in build.js, to
 * src/index.template.html, or to the SRC arrays in test/ — it has no place in
 * any of them.
 *
 * Why it exists: Build mode is the wake-locked shop companion, and a garage
 * with one bar of signal is its expected environment. Everything the app needs
 * is already inside one ~2 MB document; this worker's only job is to keep that
 * document reachable when the network is not.
 *
 * The rules it obeys, in priority order:
 *
 *   1. Never touch /api/*. Auth, the credit ledger and blueprint issuance live
 *      there; a cached or synthesised API response is a correctness and money
 *      bug. The fetch handler returns without calling respondWith for those,
 *      so they never enter the worker's control path at all.
 *   2. Never touch /b/:code. Vercel rewrites it to /api/blueprint?share=…, and
 *      it is server-rendered per code; an app-shell fallback would hand the
 *      wrong page to someone following a share link.
 *   3. Never serve a stale document to someone who has a connection.
 *      Navigations are network-FIRST; the cache answers only after the network
 *      genuinely failed. This app prints cut lists people cut wood from, so a
 *      silently old build is a worse failure than a slow load.
 *   4. Do nothing rather than something wrong. Anything that is not a
 *      navigation to the app shell falls through to the browser untouched:
 *      cross-origin, non-GET, subresources (there are none — fonts, Three.js
 *      and CSS are inlined), and every unknown path.
 *
 * Deliberately absent: skipWaiting(), clients.claim(), navigationPreload.
 * Reasons are at the handlers below.
 */
'use strict';

/* Stamped by build.js from the sha256 of the emitted dist/index.html, so the
 * cache name changes if and only if the bundle's bytes changed: an identical
 * rebuild reuses its cache instead of re-downloading 2 MB, and a real deploy
 * always lands in a fresh one. */
var STAMP = '{{BUILD_STAMP}}';
var PREFIX = 'bb-shell-';
var CACHE = PREFIX + STAMP;

/* Everything is derived from where this script actually lives, so the worker
 * is correct at the origin root (today) and under a sub-path (if the app ever
 * moves) without an edit. For /sw.js this is simply '/'. */
var ROOT = new URL('./', self.location.href).pathname;
var SHELL = ROOT;
var SHELL_ALT = ROOT + 'index.html';

/* The one cache key. '/' and '/index.html' are the same document, and query
 * strings (?app=1, ?ref=…) and hashes (#d=<share code>) are read client-side,
 * so they must not fragment the cache. */
var KEY = SHELL;

function isShell(pathname) {
  return pathname === SHELL || pathname === SHELL_ALT;
}

/* Belt and braces. The handler already only ever answers shell navigations, so
 * these paths could not reach the cache anyway — naming them makes the
 * contract explicit and survives someone widening the handler later. */
function isReserved(pathname) {
  return pathname === ROOT + 'api' || pathname.indexOf(ROOT + 'api/') === 0 ||
    pathname === ROOT + 'b' || pathname.indexOf(ROOT + 'b/') === 0;
}

/* A response is cacheable only if it is a real, final, same-origin 200 from
 * our own server. This is what keeps a captive-portal interstitial (a 200 or a
 * redirect from someone else's host) from being stored and later served as the
 * app. */
function usable(res) {
  return !!res && res.ok && res.type === 'basic' && !res.redirected;
}

/* Serving from the cache is a fact worth being able to see in DevTools or a
 * test; the body is passed through as a stream, so this costs nothing. If
 * anything about the copy is unexpected, hand back the original. */
function fromCache(hit) {
  try {
    var headers = new Headers(hit.headers);
    headers.set('X-BB-From-Cache', '1');
    headers.set('X-BB-Build', STAMP);
    return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers: headers });
  } catch (e) {
    return hit;
  }
}

/* ---- install: pre-cache the shell ----
 * Soft by design. If the pre-cache fails (flaky first load), installation
 * still succeeds and the very next successful navigation fills the cache —
 * failing install instead would leave the user with no offline support at all
 * and no retry until the next navigation anyway. */
self.addEventListener('install', function (event) {
  event.waitUntil((function () {
    return Promise.resolve().then(function () {
      return caches.open(CACHE);
    }).then(function (cache) {
      var req;
      try {
        req = new Request(SHELL, { cache: 'reload', credentials: 'same-origin' });
      } catch (e) {
        req = new Request(SHELL);
      }
      return fetch(req).then(function (res) {
        if (!usable(res)) return null;
        return cache.put(KEY, res.clone());
      });
    }).catch(function () { /* an empty cache is a pass-through worker */ });
  })());
});

/* ---- activate: drop superseded caches ----
 * Only ever our own PREFIX — a blanket caches.keys() sweep would delete
 * storage this worker did not create.
 *
 * No skipWaiting(), no clients.claim(), on purpose. A new build must not
 * replace a 2 MB app underneath someone who is on step 7 of a glue-up: the new
 * worker installs, pre-caches, and waits until every client of the old one is
 * gone. Nothing is lost by waiting, because the old worker is network-first
 * too — it keeps fetching and re-caching the CURRENT document, so a user who
 * never closes the tab still gets today's app on every load. Activation only
 * moves the worker code and garbage-collects the previous cache. */
self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) {
      return (k.indexOf(PREFIX) === 0 && k !== CACHE) ? caches.delete(k) : null;
    }));
  }).catch(function () { /* cache API unavailable — nothing to clean */ }));
});

/* Network-first, cache as fallback. Deliberately no timeout race: a slow
 * network still returns the current build, and "serve the cache after N
 * seconds" is exactly how someone ends up cutting from a superseded cut list.
 * The cache answers only when fetch() actually failed, or when the server
 * answered 5xx — a broken deploy is not a current build either. */
function shellResponse(event, request) {
  var cache = null, netRes = null, netErr = null;
  return caches.open(CACHE).then(function (c) {
    cache = c;
  }).catch(function () { /* no cache: pure pass-through below */ }).then(function () {
    return fetch(request).then(function (res) { netRes = res; }, function (err) { netErr = err; });
  }).then(function () {
    if (usable(netRes)) {
      if (cache) {
        /* Hold the worker alive for the write, but never make the user wait
         * on it: the response is returned immediately either way, and a
         * failed write (quota, eviction) just leaves the older copy. */
        try {
          event.waitUntil(cache.put(KEY, netRes.clone()).catch(function () { }));
        } catch (e) { /* clone/waitUntil unavailable — serve anyway */ }
      }
      return netRes;
    }
    /* Redirects (status 0 opaqueredirect), 3xx and 4xx are honest answers from
     * a reachable server: pass them through untouched. */
    if (netRes && netRes.status < 500) return netRes;
    return (cache ? cache.match(KEY) : Promise.resolve(null)).then(function (hit) {
      if (hit) return fromCache(hit);
      if (netRes) return netRes;
      /* Nothing cached and no network: rethrow so the browser shows its own
       * offline page — exactly what happens today with no worker at all. */
      throw netErr || new Error('offline');
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  if (request.mode !== 'navigate') return;
  if (typeof caches === 'undefined') return;
  var url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (isReserved(url.pathname)) return;
  if (!isShell(url.pathname)) return;
  event.respondWith(shellResponse(event, request));
});
