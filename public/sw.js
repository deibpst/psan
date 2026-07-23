// Cache del app shell: estáticos cache-first, /api siempre red
const VERSION = "psan-v1";
const SHELL = [
    "/", "/styles.css", "/app.js", "/api.js",
    "/views/login.js", "/views/tasks.js", "/views/calendar.js", "/views/lists.js",
    "/manifest.json", "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
    e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
    e.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);
    if (url.pathname.startsWith("/api/") || e.request.method !== "GET") return; // red directa
    e.respondWith(
        caches.match(e.request).then((hit) => hit ?? fetch(e.request))
    );
});
