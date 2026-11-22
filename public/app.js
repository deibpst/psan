import { api } from "/api.js";
import { renderLogin } from "/views/login.js";
import { renderTasks } from "/views/tasks.js";
import { renderCalendar } from "/views/calendar.js";
import { renderLists, closeList } from "/views/lists.js";

// ponytail: familia fija de 3, hardcodeada. Si crece → endpoint /api/users.
export const MEMBERS = [
    { id: 1, name: "deib", color: "var(--m-deib)" },
    { id: 2, name: "Papá", color: "var(--m-papa)" },
    { id: 3, name: "Mamá", color: "var(--m-mama)" },
];
export const memberById = (id) => MEMBERS.find((m) => m.id === id);

export let me = null;
let inactivityTimeoutMs = null;
let inactivityTimer = null;

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
    // diferencia de días de calendario (ambos a medianoche UTC = resta exacta, sin líos de zona)
    const days = Math.round((Date.parse(due + "T00:00:00Z") - Date.parse(todayStr() + "T00:00:00Z")) / 86400000);
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
    sheetEl.innerHTML = `<button type="button" class="sheet-grab" aria-label="Cerrar"></button>${html}`;
    backdrop.hidden = false;
    document.documentElement.classList.add("sheet-open"); // congela la página de atrás
    return sheetEl;
}

// Teclado en pantalla: el visual viewport se encoge y puede desplazarse (iOS no toca el layout viewport).
// Se publica el alto visible y cuánto tapa el teclado; el backdrop cubre todo el layout y el sheet se estira bajo el teclado.
const vv = window.visualViewport;
if (vv) {
    const syncViewport = () => {
        const s = document.documentElement.style;
        s.setProperty("--vvh", `${vv.height}px`);
        s.setProperty("--kb", `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px`);
    };
    vv.addEventListener("resize", syncViewport);
    vv.addEventListener("scroll", syncViewport);
}
export function closeSheet() {
    sheetEl.classList.remove("kb");
    document.documentElement.classList.remove("sheet-open");
    backdrop.hidden = true;
    sheetEl.innerHTML = "";
}
// "Teclado visible" = hay un campo enfocado; solo entonces el sheet puede hacer scroll (.kb)
const isField = (el) => !!el?.matches?.("input, textarea, select");
sheetEl.addEventListener("focusin", (e) => sheetEl.classList.toggle("kb", isField(e.target)));
sheetEl.addEventListener("focusout", (e) => { if (!isField(e.relatedTarget)) sheetEl.classList.remove("kb"); });
backdrop.addEventListener("click", (e) => { if (e.target === backdrop || e.target.closest(".sheet-grab")) closeSheet(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

// confirm nativo con texto en español; suficiente y accesible
export const confirmar = (msg) => window.confirm(msg);

// ===== Skeleton (reutiliza .group/.card para que las medidas coincidan) =====
export function skelCards(n = 3) {
    const card = `<div class="card skel-card"><div class="card-body"><div class="skel skel-line"></div><div class="skel skel-line short"></div></div></div>`;
    return `<div class="group" aria-hidden="true">${card.repeat(n)}</div>`;
}

// ===== Toast =====
const toastEl = document.getElementById("toast");
let toastTimer = null;
export function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3000);
}

// ===== Botón + de la barra (sin FAB, patrón nativo) =====
const addBtn = document.getElementById("add-btn");
export function setAddAction(fn) {
    addBtn.hidden = !fn;
    addBtn.onclick = fn ?? null;
}

// ===== Pill de la barra: se coloca bajo la pestaña activa (inset 8px por lado, 4px arriba y abajo) =====
const pill = document.querySelector(".tab-pill");
function movePill() {
    const a = document.querySelector(".tabbar a.active");
    if (!a || !a.offsetWidth) return; // barra oculta: no hay medidas
    pill.style.width = `${a.offsetWidth - 16}px`;
    pill.style.height = `${a.offsetHeight - 8}px`;
    pill.style.transform = `translate(${a.offsetLeft + 8}px, ${a.offsetTop + 4}px)`;
    // la primera posición va sin animación; desde el siguiente frame ya anima
    requestAnimationFrame(() => pill.classList.add("ready"));
}
window.addEventListener("resize", movePill);

// ===== Router =====
const views = { tareas: renderTasks, calendario: renderCalendar, listas: renderLists };

function route() {
    if (!me) return; // sin sesión manda preAuthRoute, no este router
    const name = location.hash.slice(1) || "tareas";
    if (!views[name]) { location.hash = "tareas"; return; }
    for (const el of document.querySelectorAll("#main > section")) el.hidden = true;
    for (const a of document.querySelectorAll(".tabbar a")) a.classList.toggle("active", a.dataset.tab === name);
    movePill();
    const section = document.getElementById(`view-${name}`);
    section.hidden = false;
    views[name](section);
}
window.addEventListener("hashchange", route);
document.querySelector('.tabbar a[data-tab="listas"]').addEventListener("click", () => {
    if (location.hash === "#listas") closeList(document.getElementById("view-listas"));
});

// refresco al volver a la pestaña
document.addEventListener("visibilitychange", () => {
    if (!document.hidden && me) route();
});

// ===== Sesión =====

// Apariencia: sheet con Claro / Oscuro / Sistema; el cambio se ve al instante
document.getElementById("theme-btn").addEventListener("click", () => {
    const cur = window.psanTheme.get();
    const el = openSheet(`
      <h2>Apariencia</h2>
      <div class="field"><label>Tema</label>
        <div class="seg" id="t-seg">
          ${[["light", "Claro"], ["dark", "Oscuro"], ["system", "Sistema"]].map(([k, v]) =>
            `<button type="button" data-t="${k}" class="${k === cur ? "selected" : ""}" aria-pressed="${k === cur}">${v}</button>`).join("")}
        </div></div>
      <div class="sheet-actions"><button class="btn" id="t-done">Listo</button></div>`);
    el.querySelector("#t-seg").onclick = (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        window.psanTheme.set(b.dataset.t);
        for (const x of el.querySelectorAll("#t-seg button")) {
            x.classList.toggle("selected", x === b);
            x.setAttribute("aria-pressed", String(x === b));
        }
    };
    el.querySelector("#t-done").onclick = closeSheet;
});

document.getElementById("logout").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
        await api("/api/logout", { method: "POST" });
        location.reload();
    } catch {
        btn.disabled = false;
        toast("No se pudo cerrar sesión");
    }
});

function resetInactivityTimer() {
    if (!inactivityTimeoutMs) return;
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => { location.reload(); }, inactivityTimeoutMs);
}

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart"];
for (const ev of ACTIVITY_EVENTS) {
    document.addEventListener(ev, resetInactivityTimer, { passive: true });
}

export function enterApp(user) {
    me = user;
    inactivityTimeoutMs = (user.inactivityTimeoutMinutes ?? 60) * 60 * 1000;
    resetInactivityTimer();
    document.getElementById("view-landing").hidden = true;
    document.getElementById("view-loginpage").hidden = true;
    document.getElementById("app").hidden = false;
    syncPush();
    const m = memberById(user.id);
    document.getElementById("me-avatar").outerHTML = avatarHtml(m ?? { name: user.name, color: "var(--accent)" });
    route();
}

// "/" = landing (sin sesión ni /api/me); "/app" = la app, o el login si no hay sesión (start_url del PWA)
if (location.pathname !== "/app") {
    document.getElementById("view-landing").hidden = false;
} else {
    try {
        enterApp(await api("/api/me"));
    } catch {
        renderLogin();
        document.getElementById("view-loginpage").hidden = false;
    }
}
document.getElementById("boot").hidden = true;

if ("serviceWorker" in navigator) {
    const hadController = !!navigator.serviceWorker.controller; // primera visita: nada que recargar
    // sw nuevo toma el control → recarga para ver la versión nueva; con un sheet abierto espera al próximo arranque (no pierde el borrador)
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && backdrop.hidden) location.reload(); });
    navigator.serviceWorker.register("/sw.js");
}

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
        pushBtn.disabled = true;
        try {
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
        } catch {
            toast("No se pudieron cambiar las notificaciones");
        } finally {
            pushBtn.disabled = false;
        }
    });
}

// Re-liga la suscripción de este dispositivo a quien inicia sesión (upsert): evita reactivar
// notificaciones tras cerrar sesión o si otra cuenta usa el mismo celular.
async function syncPush() {
    try {
        const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
        if (sub) await api("/api/push", { method: "POST", body: sub.toJSON() });
    } catch {} // sin push/SW o sin red: no pasa nada
}

function b64urlToBytes(s) {
    const raw = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
