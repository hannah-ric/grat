'use strict';
var STAMP = '2bb65f2213b0';
var PREFIX = 'bb-shell-';
var CACHE = PREFIX + STAMP;
var ROOT = new URL('./', self.location.href).pathname;
var SHELL = ROOT;
var SHELL_ALT = ROOT + 'index.html';
var KEY = SHELL;
function isShell(pathname) {
  return pathname === SHELL || pathname === SHELL_ALT;
}
function isReserved(pathname) {
  return pathname === ROOT + 'api' || pathname.indexOf(ROOT + 'api/') === 0 ||
    pathname === ROOT + 'b' || pathname.indexOf(ROOT + 'b/') === 0;
}
function usable(res) {
  return !!res && res.ok && res.type === 'basic' && !res.redirected;
}
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
self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) {
      return (k.indexOf(PREFIX) === 0 && k !== CACHE) ? caches.delete(k) : null;
    }));
  }).catch(function () { /* cache API unavailable — nothing to clean */ }));
});
function shellResponse(event, request) {
  var cache = null, netRes = null, netErr = null;
  return caches.open(CACHE).then(function (c) {
    cache = c;
  }).catch(function () { /* no cache: pure pass-through below */ }).then(function () {
    return fetch(request).then(function (res) { netRes = res; }, function (err) { netErr = err; });
  }).then(function () {
    if (usable(netRes)) {
      if (cache) {
        try {
          event.waitUntil(cache.put(KEY, netRes.clone()).catch(function () { }));
        } catch (e) { /* clone/waitUntil unavailable — serve anyway */ }
      }
      return netRes;
    }
    if (netRes && netRes.status < 500) return netRes;
    return (cache ? cache.match(KEY) : Promise.resolve(null)).then(function (hit) {
      if (hit) return fromCache(hit);
      if (netRes) return netRes;
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