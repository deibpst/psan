import { api, swr, repaint } from "/api.js";
import { openSheet, closeSheet, confirmar, setAddAction, setLeaveGuard, toast } from "/app.js";
import { esc } from "/views/tasks.js";

let openListId = null; // lista abierta; null = índice de listas
let emptyNew = null; // id de la lista recién creada que aún no tiene items (no se permiten listas vacías)

// salir de una lista nueva sin items: quedarse o dejar que se elimine
async function leaveEmpty() {
    if (emptyNew === null) return true;
    if (confirmar("Las listas vacías no se permiten.\n\nAceptar: quedarte y agregar un elemento.\nCancelar: salir y se eliminará esta lista.")) {
        document.getElementById("new-item")?.focus();
        return false;
    }
    const id = emptyNew;
    emptyNew = null;
    openListId = null;
    setLeaveGuard(null);
    await api(`/api/lists/${id}`, { method: "DELETE" }).catch(() => {});
    return true;
}

// tocar "Listas" estando dentro de una lista: no hay hashchange, así que vuelve al índice
export function closeList(section) {
    if (openListId === null) return;
    openListId = null;
    renderLists(section);
}

export async function renderLists(section, quiet = false) {
    setAddAction(openListId !== null
        ? () => section.querySelector("#new-item")?.focus()
        : () => newListSheet(section), openListId !== null ? "Agregar elemento" : "Crear lista");

    try {
        await swr(section, "/api/lists", {
            key: String(openListId),
            quiet,
            skeleton: () => {
                section.innerHTML = `<h1 class="large-title">Listas</h1>` + SKEL_ROWS;
            },
            paint: (lists) => paintLists(section, lists),
        });
    } catch {
        // nunca rechaza: los llamadores quiet no se enteran, y sin esto el skeleton quedaba para siempre
        if (quiet) return toast("No se pudo actualizar la vista");
        section.innerHTML = `<div class="state">No se pudieron cargar las listas.<br><br>
          <button class="btn" id="retry">Reintentar</button></div>`;
        section.querySelector("#retry").onclick = () => renderLists(section);
    }
}

// filas de una línea, alto ≈ .list-card (padding 24 + línea de texto 19)
const SKEL_ROWS = `<div class="group" aria-hidden="true">${`<div class="list-card" style="cursor:default">
    <div class="skel" style="height:19px;width:50%"></div><div class="skel" style="height:14px;width:32px"></div></div>`.repeat(3)}</div>`;

function paintLists(section, lists) {
    const open = lists.find((l) => l.id === openListId);
    if (open) return renderItems(section, open);

    if (openListId !== null) {
        // la lista abierta ya no existe (borrada en otro lado); volvemos al índice
        openListId = null;
        setAddAction(() => newListSheet(section), "Crear lista");
    }

    setLeaveGuard(null);

    const row = (l) => {
        const done = l.items.filter((i) => i.checked).length;
        return `<div class="list-card ${l.done_at ? "done" : ""}" data-list="${l.id}">
            <span>${esc(l.name)}</span>
            <span class="end"><span class="count">${done}/${l.items.length}</span>${l.done_at ? `
              <button class="icon-btn" data-reopen="${l.id}" aria-label="Reabrir lista">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              </button>` : ""}</span>
          </div>`;
    };
    const hechas = lists.filter((l) => l.done_at).sort((a, b) => new Date(b.done_at) - new Date(a.done_at));
    let html = lists.filter((l) => !l.done_at).map(row).join("");
    html = html
        ? `<div class="group">${html}</div>`
        : lists.length ? "" : `<div class="state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
                 stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
            Sin listas todavía.<br>Toca + para crear una.</div>`;
    if (hechas.length) {
        html += `<details class="hechas"><summary>Hechas (${hechas.length})</summary><div class="group">${hechas.map(row).join("")}</div></details>`;
    }
    repaint(section, () => { section.innerHTML = `<h1 class="large-title">Listas</h1>` + html; });

    section.onclick = async (e) => {
        const re = e.target.closest("[data-reopen]");
        if (re) {
            re.disabled = true;
            try {
                await api(`/api/lists/${re.dataset.reopen}`, { method: "PATCH", body: { done: false } });
                await renderLists(section, true);
                toast("Lista reabierta");
            } catch {
                re.disabled = false;
                toast("No se pudo reabrir la lista");
            }
            return;
        }
        const card = e.target.closest("[data-list]");
        if (!card) return;
        openListId = Number(card.dataset.list);
        renderLists(section);
    };
}

function newListSheet(section) {
    const el = openSheet(`
      <h2>Nueva lista</h2>
      <div class="field"><label for="l-name">Nombre</label>
        <input type="text" id="l-name" placeholder="Súper, Farmacia…"></div>
      <div class="sheet-actions">
        <button class="btn btn-secondary" id="l-cancel">Cancelar</button>
        <button class="btn" id="l-save">Crear</button>
      </div>`);
    el.querySelector("#l-cancel").onclick = closeSheet;
    el.querySelector("#l-save").onclick = async () => {
        const name = el.querySelector("#l-name").value.trim();
        if (!name) return;
        const save = el.querySelector("#l-save");
        save.disabled = true;
        try {
            const created = await api("/api/lists", { method: "POST", body: { name } });
            closeSheet();
            openListId = created.id;
            emptyNew = created.id;
            // caché de /api/lists aún no tiene la lista nueva: refresco quiet pega al server
            renderLists(section, true);
        } catch {
            save.disabled = false;
            toast("No se pudo crear la lista");
        }
    };
}

function renderItems(section, list) {
    const ro = !!list.done_at; // lista hecha: solo lectura hasta reabrirla
    if (list.items.length) { // ya tiene items: deja de ser "nueva"
        if (emptyNew === list.id) emptyNew = null;
    }
    setLeaveGuard(emptyNew === list.id ? leaveEmpty : null);
    setAddAction(ro ? null : () => section.querySelector("#new-item")?.focus(), "Agregar elemento");

    const rows = list.items.map((i) => `
        <div class="item-row">
          <input type="checkbox" id="chk-${i.id}" data-item="${i.id}" ${i.checked ? "checked" : ""} ${ro ? "disabled" : ""}>
          <label class="txt ${i.checked ? "checked" : ""}" for="chk-${i.id}">${esc(i.text)}</label>
          ${ro ? "" : `<button class="del" data-del="${i.id}" aria-label="Eliminar ${esc(i.text)}">✕</button>`}
        </div>`).join("");

    section.innerHTML = `
      <button class="btn-ghost" id="back">‹ Listas</button>
      <h1 class="large-title">${esc(list.name)}</h1>
      ${rows ? `<div class="group">${rows}</div>` : `<div class="state">Lista vacía, agrega algo abajo</div>`}
      ${ro ? "" : `<form class="quickadd" id="quickadd">
        <input type="text" id="new-item" placeholder="Agregar…" aria-label="Nuevo elemento">
        <button class="btn" type="submit">+</button>
      </form>`}
      <button class="btn btn-danger del-list" id="del-list">Eliminar lista</button>`;

    section.querySelector("#back").onclick = async () => {
        if (!(await leaveEmpty())) return;
        openListId = null;
        renderLists(section);
    };
    if (emptyNew === list.id) section.querySelector("#new-item")?.focus();

    section.querySelector("#del-list").onclick = async (e) => {
        if (!confirmar(`¿Eliminar la lista "${list.name}" y sus ${list.items.length} elementos?`)) return;
        e.target.disabled = true;
        try {
            await api(`/api/lists/${list.id}`, { method: "DELETE" });
            emptyNew = null;
            openListId = null;
            await renderLists(section, true);
            toast("Lista eliminada");
        } catch {
            e.target.disabled = false;
            toast("No se pudo eliminar la lista");
        }
    };

    if (!ro) section.querySelector("#quickadd").onsubmit = async (e) => {
        e.preventDefault();
        const form = e.target;
        const input = form.querySelector("#new-item");
        const btn = form.querySelector("button");
        const text = input.value.trim();
        if (!text) return;
        input.disabled = true;
        btn.disabled = true;
        try {
            await api(`/api/lists/${list.id}/items`, { method: "POST", body: { text } });
            input.value = ""; // ya está en el server; si el refresco falla no queremos duplicar
            await renderLists(section, true);
            section.querySelector("#new-item")?.focus(); // el repintado recrea el input
        } catch {
            toast("No se pudo agregar");
        } finally {
            input.disabled = false;
            btn.disabled = false;
        }
    };

    section.onchange = async (e) => {
        const id = e.target.dataset.item;
        if (!id) return;
        const checked = e.target.checked;
        const label = section.querySelector(`label[for="chk-${id}"]`);
        label?.classList.toggle("checked", checked);
        try {
            await api(`/api/lists/${list.id}/items`, {
                method: "PATCH",
                body: { item_id: Number(id), checked },
            });
            if (checked && !ro && [...section.querySelectorAll("[data-item]")].every((c) => c.checked)
                && confirmar("¿Marcar la lista como hecha?")) {
                try {
                    await api(`/api/lists/${list.id}`, { method: "PATCH", body: { done: true } });
                    openListId = null;
                    toast("Lista hecha");
                } catch {
                    toast("No se pudo marcar la lista como hecha");
                }
            }
            await renderLists(section, true);
            section.querySelector(`#chk-${id}`)?.focus(); // el repintado recrea el checkbox
        } catch {
            e.target.checked = !checked;
            label?.classList.toggle("checked", !checked);
            toast("No se pudo actualizar");
        }
    };

    section.onclick = async (e) => {
        if (e.target.id === "back") return;
        const del = e.target.closest("[data-del]");
        if (!del) return;
        if (!confirmar("¿Eliminar elemento?")) return;
        const row = del.closest(".item-row");
        row.classList.add("busy");
        try {
            await api(`/api/lists/${list.id}/items`, {
                method: "DELETE",
                body: { item_id: Number(del.dataset.del) },
            });
            await renderLists(section, true);
        } catch {
            toast("No se pudo eliminar");
        } finally {
            row.classList.remove("busy"); // si el repintado ya lo quitó del DOM, no hace nada
        }
    };
}
