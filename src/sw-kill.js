/* Blueprint Buddy — service-worker tombstone (the field-recovery kill switch).
 *
 * NOT A BUNDLE MODULE, and not the app's worker. `BB_SW=tombstone node build.js`
 * emits THIS as dist/sw.js instead of the real one (src/sw.js). Deploy it when
 * a worker already in the field is misbehaving and you need every browser that
 * has one to let go of it, now, without waiting for tabs to close.
 *
 * It is the opposite of src/sw.js in every respect on purpose:
 *   - skipWaiting() so it activates the moment it is fetched, instead of
 *     queueing behind the broken worker's clients;
 *   - it deletes every bb-shell-* cache;
 *   - it unregisters itself, so the origin is left with no worker at all;
 *   - it navigates its clients so open tabs come back uncontrolled, from the
 *     network, in the same session rather than at some later visit;
 *   - it installs NO fetch handler, so from its first breath every request —
 *     including /api/* — goes straight to the network.
 *
 * Once telemetry says the field is clean, switch to BB_SW=off (emit nothing)
 * or back to BB_SW=on.
 */
'use strict';

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) {
      return k.indexOf('bb-shell-') === 0 ? caches.delete(k) : null;
    }));
  }).catch(function () { /* nothing to clean */ }).then(function () {
    return self.registration.unregister();
  }).catch(function () { /* already gone */ }).then(function () {
    return self.clients.matchAll({ type: 'window' });
  }).then(function (list) {
    list.forEach(function (client) {
      try { client.navigate(client.url); } catch (e) { /* client is gone */ }
    });
  }).catch(function () { /* best effort */ }));
});
