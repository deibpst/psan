import { api } from "/api.js";
import {
    MEMBERS, memberById, avatarHtml, avatarsHtml, urgency, duePart, todayStr,
    fmtTime, STATUS_LABEL, openSheet, closeSheet, confirmar, me, setAddAction,
} from "/app.js";

export async function renderTasks(section) {
    section.innerHTML = `<div class="state"><div class="spinner"></div>Cargando…</div>`;

    let tasks;
    try {
        tasks = await api("/api/tasks");
    } catch {
        section.innerHTML = `<div class="state">No se pudieron cargar las tareas.<br><br>
          <button class="btn" id="retry">Reintentar</button></div>`;
        section.querySelector("#retry").onclick = () => renderTasks(section);
        return;
    }

    const hoy = todayStr();
    const manana = plusDays(hoy, 1);
    const semana = plusDays(hoy, 7);

    const groups = { Vencidas: [], Hoy: [], "Mañana": [], "Esta semana": [], "Después": [], "Sin fecha": [] };
    const hechas = [];

    for (const t of tasks) {
        if (t.status === "done") { hechas.push(t); continue; }
        const due = duePart(t);
        if (!due) groups["Sin fecha"].push(t);
        else if (due < hoy) groups.Vencidas.push(t);
        else if (due === hoy) groups.Hoy.push(t);
        else if (due === manana) groups["Mañana"].push(t);
        else if (due <= semana) groups["Esta semana"].push(t);
        else groups["Después"].push(t);
    }

    let html = "";
    for (const [name, list] of Object.entries(groups)) {
        if (!list.length) continue;
        html += `<h2 class="group-title">${name}</h2><div class="group">${list.map(cardHtml).join("")}</div>`;
    }
    if (!html) html = `<div class="state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
             stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        Sin tareas pendientes.<br>Toca + para crear una.</div>`;
    if (hechas.length) {
        html += `<details class="hechas"><summary>Hechas (${hechas.length})</summary><div class="group">${hechas.map(cardHtml).join("")}</div></details>`;
    }
    section.innerHTML = `<h1 class="large-title">Tareas</h1>` + html;

    setAddAction(() => taskSheet(null, section));
    section.onclick = (e) => {
        const doneBtn = e.target.closest("[data-done]");
        if (doneBtn) {
            e.stopPropagation();
            markDone(Number(doneBtn.dataset.done), section);
            return;
        }
        const card = e.target.closest("[data-task]");
        if (card) taskSheet(tasks.find((t) => t.id === Number(card.dataset.task)), section);
    };
}

function plusDays(ymd, n) {
    const d = new Date(ymd + "T12:00:00");
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
}

function cardHtml(t) {
    const u = urgency(t);
    const attribution = t.status_changed_by
        ? `${STATUS_LABEL[t.status]} · ${memberById(t.status_changed_by)?.name ?? "?"} · ${fmtTime(t.status_changed_at)}`
        : STATUS_LABEL[t.status];
    const doneBtn = t.status === "done" ? "" :
        `<button class="icon-btn" data-done="${t.id}" aria-label="Marcar como hecha">
           <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
         </button>`;
    return `
      <article class="card" data-task="${t.id}" style="--u:${u.color}">
        <div class="card-body">
          <div class="card-title ${t.status === "done" ? "done" : ""}">${t.recurrence ? "↻ " : ""}${esc(t.title)}</div>
          <div class="card-meta">
            <span class="dot"></span><span>${u.label}</span>
            <span class="chip">${attribution}</span>
          </div>
        </div>
        ${avatarsHtml(t.assignees)}
        ${doneBtn}
      </article>`;
}

async function markDone(id, section) {
    if (!confirmar("¿Marcar como hecha?")) return;
    await api(`/api/tasks/${id}`, { method: "PATCH", body: { status: "done" } });
    renderTasks(section);
}

const REC_LABEL = { "": "No se repite", daily: "Diario", weekly: "Semanal", biweekly: "Quincenal", monthly: "Mensual" };

function taskSheet(task, section) {
    const isEdit = !!task;
    let status = task?.status ?? "pending";
    let assignees = task?.assignees ?? [];
    let recurrence = task?.recurrence ?? "";

    const el = openSheet(`
      <h2>${isEdit ? "Editar tarea" : "Nueva tarea"}</h2>
      <div class="field"><label for="f-title">Título</label>
        <input type="text" id="f-title" value="${esc(task?.title ?? "")}" required></div>
      <div class="field"><label for="f-notes">Notas</label>
        <textarea id="f-notes">${esc(task?.notes ?? "")}</textarea></div>
      <div class="field"><label for="f-due">Fecha límite</label>
        <input type="date" id="f-due" value="${duePart(task ?? {}) ?? ""}"></div>
      <div class="field"><label>Asignada a</label>
        <div class="member-row" id="f-assignee">
          ${MEMBERS.map((m) => `<button type="button" data-id="${m.id}" class="${assignees.includes(m.id) ? "selected" : ""}"
              aria-pressed="${assignees.includes(m.id)}">
              ${avatarHtml(m)}<span>${m.name}</span></button>`).join("")}
        </div></div>
      <div class="field"><label>Se repite</label>
        <div class="seg" id="f-rec">
          ${Object.entries(REC_LABEL).map(([k, v]) =>
            `<button type="button" data-r="${k}" class="${k === recurrence ? "selected" : ""}">${v}</button>`).join("")}
        </div></div>
      <div class="field"><label>Estado</label>
        <div class="seg" id="f-status">
          ${Object.entries(STATUS_LABEL).map(([k, v]) =>
            `<button type="button" data-s="${k}" class="${k === status ? "selected" : ""}">${v}</button>`).join("")}
        </div></div>
      <div class="sheet-actions">
        ${isEdit && task.created_by === me.id ? `<button class="btn btn-danger" id="f-delete">Eliminar</button>` : ""}
        <button class="btn btn-secondary" id="f-cancel">Cancelar</button>
        <button class="btn" id="f-save">Guardar</button>
      </div>`);

    el.querySelector("#f-assignee").onclick = (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;
        const id = Number(btn.dataset.id);
        assignees = assignees.includes(id) ? assignees.filter((a) => a !== id) : [...assignees, id];
        const on = assignees.includes(id);
        btn.classList.toggle("selected", on);
        btn.setAttribute("aria-pressed", String(on));
    };
    el.querySelector("#f-rec").onclick = (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;
        recurrence = btn.dataset.r;
        for (const b of el.querySelectorAll("#f-rec button"))
            b.classList.toggle("selected", b.dataset.r === recurrence);
    };
    el.querySelector("#f-status").onclick = (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;
        status = btn.dataset.s;
        for (const b of el.querySelectorAll("#f-status button"))
            b.classList.toggle("selected", b.dataset.s === status);
    };
    el.querySelector("#f-cancel").onclick = closeSheet;

    if (isEdit && task.created_by === me.id) {
        el.querySelector("#f-delete").onclick = async () => {
            if (!confirmar("¿Eliminar tarea?")) return;
            await api(`/api/tasks/${task.id}`, { method: "DELETE" });
            closeSheet();
            renderTasks(section);
        };
    }

    el.querySelector("#f-save").onclick = async () => {
        const title = el.querySelector("#f-title").value.trim();
        if (!title) { el.querySelector("#f-title").focus(); return; }
        if (status === "done" && task?.status !== "done" && !confirmar("¿Marcar como hecha?")) return;

        const body = {
            title,
            notes: el.querySelector("#f-notes").value.trim() || null,
            due_date: el.querySelector("#f-due").value || null,
            assignees,
            recurrence: recurrence || null,
        };
        if (isEdit) {
            await api(`/api/tasks/${task.id}`, { method: "PATCH", body: { ...body, status } });
        } else {
            const created = await api("/api/tasks", { method: "POST", body });
            if (status !== "pending") await api(`/api/tasks/${created.id}`, { method: "PATCH", body: { status } });
        }
        closeSheet();
        renderTasks(section);
    };
}

export const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
