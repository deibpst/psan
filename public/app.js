import { api } from "/api.js";
import { renderLogin } from "/views/login.js";
import { renderTasks } from "/views/tasks.js";
import { renderCalendar } from "/views/calendar.js";
import { renderLists } from "/views/lists.js";

// ponytail: familia fija de 3, hardcodeada. Si crece → endpoint /api/users.
export const MEMBERS = [
    { id: 1, name: "deib", color: "var(--m-deib)" },
    { id: 2, name: "papá", color: "var(--m-papa)" },
    { id: 3, name: "mamá", color: "var(--m-mama)" },
];
export const memberById = (id) => MEMBERS.find((m) => m.id === id);

export let me = null;

// ===== Fechas (siempre CDMX/GDL/Puebla) =====
const TZ = "America/Mexico_City";
export const fmtTime = (iso) =>
    new Intl.DateTimeFormat("es-MX", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
export const fmtDay = (iso) =>
    new Intl.DateTimeFormat("es-MX", { timeZone: TZ, day: "numeric", month: "short" }).format(new Date(iso));

// "YYYY-MM-DD" de hoy en CDMX
export function todayStr() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}
export const dateStr = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);

// due_date llega como ISO timestamp; nos quedamos con la parte de fecha
export const duePart = (t) => (t.due_date ? t.due_date.slice(0, 10) : null);

// ===== Urgencia (semáforo) =====
export function urgency(task) {
    if (task.status === "done") return { color: "var(--u-green)", label: "Hecha" };
    const due = duePart(task);
    if (!due) return { color: "var(--u-blue-faint)", label: "Sin fecha" };
    const days = Math.ceil((new Date(due + "T23:59:59") - Date.now()) / 86400000);
    if (days < 0) return { color: "var(--u-red)", label: "Vencida" };
    if (days <= 2) return { color: "var(--u-red)", label: days === 0 ? "Hoy" : days === 1 ? "Mañana" : "2 días" };
    if (days < 4) return { color: "var(--u-yellow)", label: `${days} días` };
    return { color: "var(--u-blue)", label: fmtDay(due + "T12:00:00") };
}

export const STATUS_LABEL = { pending: "Pendiente", in_progress: "En progreso", done: "Hecha" };

// ===== Avatar =====
export function avatarHtml(member, cls = "avatar") {
    if (!member) return "";
    return `<span class="${cls}" style="background:${member.color}" title="${member.name}">${member.name[0].toUpperCase()}</span>`;
}

// Varios asignados: círculos apilados con leve traslape
export function avatarsHtml(ids, cls = "avatar sm") {
    const html = (ids ?? []).map((id) => avatarHtml(memberById(id), cls)).join("");
    return html ? `<span class="avatar-stack">${html}</span>` : "";
}

// ===== Sheet =====
const backdrop = document.getElementById("sheet-backdrop");
const sheetEl = document.getElementById("sheet");

export function openSheet(html) {
    sheetEl.innerHTML = html;
    backdrop.hidden = false;
    sheetEl.querySelector("input, textarea, button")?.focus();
    return sheetEl;
}
export function closeSheet() {
    backdrop.hidden = true;
    sheetEl.innerHTML = "";
}
backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeSheet(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

// confirm nativo con texto en español; suficiente y accesible
export const confirmar = (msg) => window.confirm(msg);

// ===== Botón + de la barra (sin FAB, patrón nativo) =====
const addBtn = document.getElementById("add-btn");
export function setAddAction(fn) {
    addBtn.hidden = !fn;
    addBtn.onclick = fn ?? null;
}

// ===== Router =====
const views = { tareas: renderTasks, calendario: renderCalendar, listas: renderLists };

function route() {
    const name = location.hash.slice(1) || "tareas";
    if (!views[name]) { location.hash = "tareas"; return; }
    for (const el of document.querySelectorAll("#main > section")) el.hidden = true;
    for (const a of document.querySelectorAll(".tabbar a")) a.classList.toggle("active", a.dataset.tab === name);
    const section = document.getElementById(`view-${name}`);
    section.hidden = false;
    views[name](section);
}
window.addEventListener("hashchange", route);

// refresco al volver a la pestaña
document.addEventListener("visibilitychange", () => {
    if (!document.hidden && me) route();
});

// ===== Tema =====
// Favicon acorde al tema: claro = original, oscuro = invertido (canvas, sin assets extra)
const faviconLink = document.querySelector('link[rel="icon"]');
function updateFavicon(theme) {
    if (theme !== "dark") { faviconLink.href = "/psan.ico"; return; }
    const img = new Image();
    img.src = "/icons/icon-192.png";
    img.onload = () => {
        const c = document.createElement("canvas");
        c.width = c.height = 64;
        const ctx = c.getContext("2d");
        ctx.filter = "invert(1)";
        ctx.drawImage(img, 0, 0, 64, 64);
        faviconLink.href = c.toDataURL();
    };
}
updateFavicon(document.documentElement.dataset.theme);

document.getElementById("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
    updateFavicon(next);
});

// ===== Sesión =====
document.getElementById("logout").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    location.reload();
});

export function enterApp(user) {
    me = user;
    document.getElementById("view-login").hidden = true;
    document.getElementById("app").hidden = false;
    const m = memberById(user.id);
    document.getElementById("me-avatar").outerHTML = avatarHtml(m ?? { name: user.name, color: "var(--accent)" });
    route();
}

// arranque
try {
    enterApp(await api("/api/me"));
} catch {
    renderLogin(document.getElementById("view-login"));
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");

// ===== Notificaciones push =====
const pushBtn = document.getElementById("push-toggle");

function setPushState(on) {
    pushBtn.classList.toggle("on", on);
    pushBtn.setAttribute("aria-pressed", String(on));
    pushBtn.setAttribute("aria-label", on ? "Desactivar notificaciones" : "Activar notificaciones");
}

if ("serviceWorker" in navigator && "PushManager" in window) {
    pushBtn.hidden = false;
    navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => setPushState(!!sub));

    pushBtn.addEventListener("click", async () => {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
            await api("/api/push", { method: "DELETE", body: { endpoint: sub.endpoint } });
            await sub.unsubscribe();
            setPushState(false);
            return;
        }
        if ((await Notification.requestPermission()) !== "granted") return;
        const { key } = await api("/api/push");
        const newSub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: b64urlToBytes(key),
        });
        await api("/api/push", { method: "POST", body: newSub.toJSON() });
        setPushState(true);
    });
}

function b64urlToBytes(s) {
    const raw = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
