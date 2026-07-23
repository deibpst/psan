// Cache del app shell: estáticos cache-first, /api siempre red
const VERSION = "psan-v5";
const SHELL = [
    "/", "/styles.css", "/app.js", "/api.js",
    "/views/login.js", "/views/tasks.js", "/views/calendar.js", "/views/lists.js",
    "/manifest.json", "/psan.ico", "/icons/icon-192.png", "/icons/icon-512.png",
    "/fonts/outfit-var.woff2", "/fonts/reenie-beanie.woff2",
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

// Push sin payload: el SW consulta la API (con cookie de sesión) y compone el texto
self.addEventListener("push", (e) => {
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
    e.waitUntil(
        fetch("/api/tasks", { credentials: "same-origin" })
            .then((r) => r.json())
            .then((tasks) => {
                const n = tasks.filter((t) =>
                    t.status !== "done" && t.due_date && t.due_date.slice(0, 10) <= hoy).length;
                return n === 1 ? "1 tarea por vencer" : `${n} tareas por vencer`;
            })
            .catch(() => "Tienes tareas por vencer")
            .then((body) =>
                self.registration.showNotification("psan", { body, icon: "/icons/icon-192.png" }))
    );
});

self.addEventListener("notificationclick", (e) => {
    e.notification.close();
    e.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) =>
            wins[0] ? wins[0].focus() : clients.openWindow("/"))
    );
});
