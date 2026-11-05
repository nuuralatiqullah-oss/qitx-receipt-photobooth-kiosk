/* ============================================================
   SERVICE WORKER
   Two jobs: make the booth installable, and keep it running when
   the venue wifi drops.

   Strategy — network-first for the booth's own files, cache as
   the fallback. The earlier cache-first version meant every
   deploy landed one reload late: the tablet served the old file
   and only fetched the new one for *next* time. With a 3 second
   timeout, an online tablet always runs the current code, and an
   offline one still opens from cache.

   Fonts and the Supabase CDN stay cache-first: they are
   versioned, never change under the same URL, and should not
   cost a round trip at every event.
   ============================================================ */
const VERSION = "v15";
const CACHE = "kiosk-" + VERSION;
const NET_TIMEOUT = 3000;

const SHELL = [
  "./",
  "./index.html",
  "./admin.html",
  "./manifest.webmanifest",
  "./assets/config.js",
  "./assets/settings.js",
  "./assets/frames.js",
  "./assets/imaging.js",
  "./assets/printer.js",
  "./assets/remote.js",
  "./assets/app.js",
  "./assets/admin.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/maskable-512.png"
];

const CDN = /fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/;

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      // addAll fails the whole install if any one file 404s, so add
      // them individually and let the rest through.
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Admin asks "what version are you?" so the tablet can prove what
   it is actually running, and can force an update. */
self.addEventListener("message", function (e) {
  const msg = e.data || {};
  if (msg.type === "VERSION") {
    const reply = { type: "VERSION", version: VERSION, cache: CACHE };
    if (e.ports && e.ports[0]) e.ports[0].postMessage(reply);
    else if (e.source) e.source.postMessage(reply);
  }
  if (msg.type === "SKIP_WAITING") self.skipWaiting();
});

function fromNetwork(req, sameOrigin) {
  return new Promise(function (resolve, reject) {
    let settled = false;
    const timer = setTimeout(function () {
      if (!settled) { settled = true; reject(new Error("timeout")); }
    }, NET_TIMEOUT);

    fetch(req).then(function (res) {
      clearTimeout(timer);
      if (settled) {
        // Too slow for this request, but still worth caching.
        if (res && res.ok) caches.open(CACHE).then(c => c.put(req, res.clone())).catch(() => {});
        return;
      }
      settled = true;
      if (res && res.ok && (sameOrigin || res.type === "cors")) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      resolve(res);
    }).catch(function (err) {
      clearTimeout(timer);
      if (!settled) { settled = true; reject(err); }
    });
  });
}

self.addEventListener("fetch", function (e) {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Supabase and other APIs must always go straight to the network.
  if (!sameOrigin && !CDN.test(url.hostname)) return;

  // Immutable third-party assets: cache-first is right for these.
  if (!sameOrigin) {
    e.respondWith(
      caches.match(req).then(hit => hit || fromNetwork(req, false).catch(() => new Response("", { status: 504 })))
    );
    return;
  }

  // The booth's own files: fresh if we can get it, cache if we can't.
  e.respondWith(
    fromNetwork(req, true).catch(function () {
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        if (req.mode === "navigate") return caches.match("./index.html");
        return new Response("", { status: 504, statusText: "Offline" });
      });
    })
  );
});
