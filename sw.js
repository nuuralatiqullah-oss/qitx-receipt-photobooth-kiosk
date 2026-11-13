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
const VERSION = "v21";
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
  "./assets/vendor/supabase.min.js",
  "./assets/vendor/qrcode.min.js",
  "./assets/vendor/gifenc.min.js",
  "./assets/press.css",
  "./assets/vendor/fonts/playfair-900.woff2",
  "./assets/vendor/fonts/playfair-700.woff2",
  "./assets/vendor/fonts/oswald-600.woff2",
  "./assets/animate.js",
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

/* Fetch and cache. No timeout here: a timeout that turns into a
   response would be an EMPTY response, and an empty script tag is
   worse than a slow one. v15 did exactly that and silently cost the
   booth its Supabase client. */
function netFetch(req, sameOrigin) {
  return fetch(req).then(function (res) {
    if (res && res.ok && (sameOrigin || res.type === "cors")) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
    }
    return res;
  });
}

function offline(req) {
  if (req.mode === "navigate") {
    return caches.match("./index.html").then(hit => hit || new Response("", { status: 504, statusText: "Offline" }));
  }
  return Promise.resolve(new Response("", { status: 504, statusText: "Offline" }));
}

/* Same-origin: current code when we can get it, cached code when the
   network is slow. The timeout only decides whether to WAIT for the
   network — it is armed only when there is a cached copy to fall back
   on, so a slow network can never yield an empty response. */
async function appFile(req) {
  const net = netFetch(req, true);
  net.catch(() => {});                   // the race below may ignore it

  const cached = await caches.match(req);
  if (!cached) {
    try { return await net; } catch (e) { return offline(req); }
  }

  let timer;
  const tick = new Promise(r => { timer = setTimeout(() => r("timeout"), NET_TIMEOUT); });
  try {
    const won = await Promise.race([net, tick]);
    if (won === "timeout" || !won || !won.ok) return cached;
    return won;
  } catch (e) {
    return cached;
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener("fetch", function (e) {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Supabase and other APIs must always go straight to the network.
  if (!sameOrigin && !CDN.test(url.hostname)) return;

  // Third-party assets are immutable: cache first, then a plain
  // untimed fetch. Nothing here is ever faked with an empty body.
  if (!sameOrigin) {
    e.respondWith(
      caches.match(req).then(hit => hit || netFetch(req, false).catch(() => offline(req)))
    );
    return;
  }

  e.respondWith(appFile(req));
});
