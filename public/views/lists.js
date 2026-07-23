import { api } from "/api.js";
import { openSheet, closeSheet, confirmar } from "/app.js";
import { esc } from "/views/tasks.js";

let openListId = null; // lista abierta; null = índice de listas

export async function renderLists(section) {
    section.innerHTML = `<div class="state"><div class="spinner"></div>Cargando…</div>`;

    let lists;
    try {
        lists = await api("/api/lists");
    } catch {
        section.innerHTML = `<div class="state">No se pudieron cargar las listas.<br><br>
          <button class="btn" id="retry">Reintentar</button></div>`;
        section.querySelector("#retry").onclick = () => renderLists(section);
        return;
    }

    const open = lists.find((l) => l.id === openListId);
    if (open) return renderItems(section, open);

    openListId = null;
    let html = lists.map((l) => {
        const done = l.items.filter((i) => i.checked).length;
        return `<div class="list-card" data-list="${l.id}">
            <span>${esc(l.name)}</span>
            <span class="count">${done}/${l.items.length}</span>
          </div>`;
    }).join("");
    if (!html) html = `<div class="state">Sin listas todavía.<br>Crea una con el botón +</div>`;
    html += `<button class="fab" id="fab-list" aria-label="Nueva lista">+</button>`;
    section.innerHTML = html;

    section.querySelector("#fab-list").onclick = () => {
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
            const created = await api("/api/lists", { method: "POST", body: { name } });
            closeSheet();
            openListId = created.id;
            renderLists(section);
        };
    };

    section.onclick = (e) => {
        if (e.target.closest("#fab-list")) return;
        const card = e.target.closest("[data-list]");
        if (!card) return;
        openListId = Number(card.dataset.list);
        renderLists(section);
    };
}

function renderItems(section, list) {
    const rows = list.items.map((i) => `
        <div class="item-row">
          <input type="checkbox" id="chk-${i.id}" data-item="${i.id}" ${i.checked ? "checked" : ""}>
          <label class="txt ${i.checked ? "checked" : ""}" for="chk-${i.id}">${esc(i.text)}</label>
          <button class="del" data-del="${i.id}" aria-label="Eliminar ${esc(i.text)}">✕</button>
        </div>`).join("");

    section.innerHTML = `
      <button class="btn-ghost" id="back">← Listas</button>
      <h2 style="margin:var(--space-2) 0 var(--space-3)">${esc(list.name)}</h2>
      ${rows || `<div class="state">Lista vacía — agrega algo abajo</div>`}
      <form class="quickadd" id="quickadd">
        <input type="text" id="new-item" placeholder="Agregar…" aria-label="Nuevo elemento">
        <button class="btn" type="submit">+</button>
      </form>`;

    section.querySelector("#back").onclick = () => { openListId = null; renderLists(section); };

    section.querySelector("#quickadd").onsubmit = async (e) => {
        e.preventDefault();
        const text = section.querySelector("#new-item").value.trim();
        if (!text) return;
        await api(`/api/lists/${list.id}/items`, { method: "POST", body: { text } });
        renderLists(section);
    };

    section.onchange = async (e) => {
        const id = e.target.dataset.item;
        if (!id) return;
        await api(`/api/lists/${list.id}/items`, {
            method: "PATCH",
            body: { item_id: Number(id), checked: e.target.checked },
        });
        renderLists(section);
    };

    section.onclick = async (e) => {
        if (e.target.id === "back") return;
        const del = e.target.closest("[data-del]");
        if (!del) return;
        if (!confirmar("¿Eliminar elemento?")) return;
        await api(`/api/lists/${list.id}/items`, {
            method: "DELETE",
            body: { item_id: Number(del.dataset.del) },
        });
        renderLists(section);
    };
}
