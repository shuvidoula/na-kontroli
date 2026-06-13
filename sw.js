const CACHE_NAME = "na-kontroli-pages-v1.1.13";
const FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./vendor/framework7/framework7-bundle.min.css",
  "./vendor/framework7/framework7-bundle.min.js",
  "./src/css/app.css",
  "./src/js/crypto.js",
  "./src/js/storage.js",
  "./src/js/app.js"
];

const INDEX_URL = new URL("./index.html", self.location.href).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(FILES.map((file) => cache.add(file).catch(() => undefined))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true })
        .then((cached) => cached || caches.match(INDEX_URL))
        .then((cached) => cached || fetch(event.request))
        .catch(() => caches.match(INDEX_URL))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (!response || response.status !== 200) return response;
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(INDEX_URL));
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow("./");
      return undefined;
    })
  );
});
