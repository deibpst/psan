import { api } from "/api.js";
import { memberById, avatarHtml, urgency, duePart, todayStr, STATUS_LABEL } from "/app.js";
import { esc } from "/views/tasks.js";

const DOW = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
let mode = window.innerWidth >= 1024 ? "month" : "week"; // móvil: semana; escritorio: mes
let anchor = null;   // Date dentro del periodo visible
let selected = null; // "YYYY-MM-DD"

export async function renderCalendar(section) {
    anchor ??= new Date(todayStr() + "T12:00:00");
    selected ??= todayStr();

    const [from, to] = range();
    section.innerHTML = `<div class="state"><div class="spinner"></div>Cargando…</div>`;

    let tasks;
    try {
        tasks = await api(`/api/tasks?from=${from}&to=${to}`);
    } catch {
        section.innerHTML = `<div class="state">No se pudo cargar el calendario.<br><br>
          <button class="btn" id="retry">Reintentar</button></div>`;
        section.querySelector("#retry").onclick = () => renderCalendar(section);
        return;
    }

    const byDay = {};
    for (const t of tasks) (byDay[duePart(t)] ??= []).push(t);

    const title = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(anchor);

    section.innerHTML = `
      <div class="cal-head">
        <span class="title">${title}</span>
        <div class="cal-nav">
          <button class="icon-btn" id="cal-prev" aria-label="Anterior">‹</button>
          <button class="icon-btn" id="cal-today" aria-label="Hoy">•</button>
          <button class="icon-btn" id="cal-next" aria-label="Siguiente">›</button>
          <button class="icon-btn" id="cal-mode" aria-label="Cambiar vista">
            ${mode === "week" ? "▦" : "▤"}
          </button>
        </div>
      </div>
      ${mode === "week" ? weekHtml(byDay) : monthHtml(byDay)}
      <div id="cal-day-list">${dayListHtml(byDay[selected] ?? [])}</div>`;

    section.querySelector("#cal-prev").onclick = () => { move(-1); renderCalendar(section); };
    section.querySelector("#cal-next").onclick = () => { move(1); renderCalendar(section); };
    section.querySelector("#cal-today").onclick = () => {
        anchor = new Date(todayStr() + "T12:00:00"); selected = todayStr(); renderCalendar(section);
    };
    section.querySelector("#cal-mode").onclick = () => {
        mode = mode === "week" ? "month" : "week"; renderCalendar(section);
    };
    section.onclick = (e) => {
        const day = e.target.closest("[data-day]");
        if (!day) return;
        selected = day.dataset.day;
        renderCalendar(section);
    };
}

function move(dir) {
    if (mode === "week") anchor.setDate(anchor.getDate() + dir * 7);
    else anchor.setMonth(anchor.getMonth() + dir, 1);
}

// lunes de la semana de una fecha
function monday(d) {
    const x = new Date(d);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
}
const ymd = (d) => d.toISOString().slice(0, 10);

function range() {
    if (mode === "week") {
        const start = monday(anchor);
        const end = new Date(start); end.setDate(end.getDate() + 6);
        return [ymd(start), ymd(end)];
    }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 12);
    return [ymd(monday(first)), ymd(addDays(monday(last), 6))];
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function dotsHtml(list) {
    // máx 3 puntos por día, coloreados por urgencia
    return `<span class="day-dots">${(list ?? []).slice(0, 3)
        .map((t) => `<i style="background:${urgency(t).color}"></i>`).join("")}</span>`;
}

function weekHtml(byDay) {
    const hoy = todayStr();
    const start = monday(anchor);
    let cells = "";
    for (let i = 0; i < 7; i++) {
        const d = addDays(start, i);
        const key = ymd(d);
        cells += `<button class="day ${key === hoy ? "today" : ""} ${key === selected ? "selected" : ""}" data-day="${key}">
            <span>${DOW[i]}</span><span class="num">${d.getDate()}</span>${dotsHtml(byDay[key])}
          </button>`;
    }
    return `<div class="week-strip">${cells}</div>`;
}

function monthHtml(byDay) {
    const hoy = todayStr();
    let cells = DOW.map((d) => `<span class="dow">${d}</span>`).join("");
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12);
    let d = monday(first);
    for (let i = 0; i < 42; i++) {
        const key = ymd(d);
        const other = d.getMonth() !== anchor.getMonth();
        cells += `<button class="cell ${other ? "other" : ""} ${key === hoy ? "today" : ""} ${key === selected ? "selected" : ""}"
            data-day="${key}"><span>${d.getDate()}</span>${dotsHtml(byDay[key])}</button>`;
        d = addDays(d, 1);
        if (i >= 34 && d.getMonth() !== anchor.getMonth() && d.getDay() === 1) break; // no filas vacías
    }
    return `<div class="month-grid">${cells}</div>`;
}

function dayListHtml(list) {
    if (!list.length) return `<div class="state">Sin tareas este día</div>`;
    return list.map((t) => {
        const u = urgency(t);
        return `<article class="card" style="--u:${u.color}">
          <div class="card-body">
            <div class="card-title ${t.status === "done" ? "done" : ""}">${esc(t.title)}</div>
            <div class="card-meta"><span class="dot"></span><span>${STATUS_LABEL[t.status]}</span></div>
          </div>
          ${avatarHtml(memberById(t.assigned_to), "avatar sm")}
        </article>`;
    }).join("");
}
