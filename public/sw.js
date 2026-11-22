// Cache del app shell: estáticos cache-first, /api siempre red
const VERSION = "psan-v59";
const SHELL = [
    "/", "/app", "/styles.css", "/app.js", "/api.js",
    "/views/login.js", "/views/tasks.js", "/views/calendar.js", "/views/lists.js",
    "/manifest.json", "/psan.ico", "/icons/icon-192.png", "/icons/icon-512.png",
    "/icons/pwa-icon-180.png", "/icons/pwa-icon-192.png", "/icons/pwa-icon-512.png", "/icons/pwa-icon-1024.png",
    "/flwr.jpg", "/flwr2.jpg", "/flwr3.jpg", "/fonts/dm-sans-var.woff2",
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

// Push sin payload: el SW pide sus avisos por endpoint de suscripción (no depende de la
// sesión, que caduca) y el servidor ya trae el texto armado.
const notify = (title, body) =>
    self.registration.showNotification(title || "psan", { body, icon: "/icons/icon-192.png" });

self.addEventListener("push", (e) => {
    e.waitUntil((async () => {
        try {
            const sub = await self.registration.pushManager.getSubscription();
            const pending = await fetch("/api/notifications", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ endpoint: sub.endpoint }),
            }).then((r) => r.json());
            if (Array.isArray(pending) && pending.length) {
                for (const n of pending.slice(0, 3)) await notify(n.title, n.body);
                if (pending.length > 3) await notify("Más avisos", `…y ${pending.length - 3} más`);
                return;
            }
        } catch {}
        // iOS exige mostrar algo en cada push: lista vacía (push duplicado) o red caída
        await notify("Novedades", "Hay novedades en psan");
    })());
});

self.addEventListener("notificationclick", (e) => {
    e.notification.close();
    e.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) =>
            wins[0] ? wins[0].focus() : clients.openWindow("/app"))
    );
});
