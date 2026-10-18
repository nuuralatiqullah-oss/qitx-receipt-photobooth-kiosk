/* ============================================================
   SERVICE WORKER
   Two jobs: make the booth installable, and keep it running when
   the venue wifi drops. The app shell is cached on install and
   served cache-first, so a reception hall with no signal still
   gets a working booth.

   Bump CACHE when you change any cached file, or tablets will
   keep serving the old one.
   ============================================================ */
const CACHE = "kiosk-v8";

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
  "./assets/app.js",
  "./assets/admin.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/maskable-512.png"
];

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

self.addEventListener("fetch", function (e) {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Supabase and other APIs must always go to the network.
  if (!sameOrigin && !/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(url.hostname)) {
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) {
        // Refresh in the background so the next load is current.
        e.waitUntil(
          fetch(req).then(res => {
            if (res && res.ok) return caches.open(CACHE).then(c => c.put(req, res.clone()));
          }).catch(() => {})
        );
        return hit;
      }
      return fetch(req).then(function (res) {
        if (res && res.ok && (sameOrigin || res.type === "cors")) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(function () {
        // Offline and not cached: fall back to the booth page for
        // navigations so the app still opens.
        if (req.mode === "navigate") return caches.match("./index.html");
        return new Response("", { status: 504, statusText: "Offline" });
      });
    })
  );
});
