// Cache del app shell: estáticos cache-first, /api siempre red
const VERSION = "psan-v13";
const SHELL = [
    "/", "/styles.css", "/app.js", "/api.js",
    "/views/login.js", "/views/tasks.js", "/views/calendar.js", "/views/lists.js",
    "/manifest.json", "/psan.ico", "/icons/icon-192.png", "/icons/icon-512.png",
    "/flwr.jpg", "/flwr2.jpg", "/flwr3.jpg", "/fonts/inter-var.woff2",
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

// Push sin payload: el SW consulta la API (con cookie de sesión) y compone el texto.
// Primero avisos por evento pendientes; si no hay, es el recordatorio diario.
const notify = (body) =>
    self.registration.showNotification("psan", { body, icon: "/icons/icon-192.png" });

self.addEventListener("push", (e) => {
    e.waitUntil((async () => {
        try {
            const pending = await fetch("/api/notifications", { credentials: "same-origin" }).then((r) => r.json());
            if (Array.isArray(pending) && pending.length) {
                for (const n of pending.slice(0, 3)) await notify(n.body);
                if (pending.length > 3) await notify(`…y ${pending.length - 3} avisos más`);
                return;
            }
            const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
            const tasks = await fetch("/api/tasks", { credentials: "same-origin" }).then((r) => r.json());
            const n = tasks.filter((t) =>
                t.status !== "done" && t.due_date && t.due_date.slice(0, 10) <= hoy).length;
            // n=0: otro dispositivo ya recogió el aviso — mensaje genérico
            await notify(n === 0 ? "Tienes actividad nueva" : n === 1 ? "1 tarea por vencer" : `${n} tareas por vencer`);
        } catch {
            await notify("Tienes actividad nueva");
        }
    })());
});

self.addEventListener("notificationclick", (e) => {
    e.notification.close();
    e.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) =>
            wins[0] ? wins[0].focus() : clients.openWindow("/"))
    );
});
