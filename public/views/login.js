import { api } from "/api.js";
import { MEMBERS, avatarHtml, enterApp } from "/app.js";

let selected = null;
let pin = "";

export function renderLogin(section) {
    section.hidden = false;

    const names = document.getElementById("login-names");
    names.innerHTML = MEMBERS.map(
        (m) => `<button type="button" data-id="${m.id}">${avatarHtml(m)}<span>${m.name}</span></button>`
    ).join("");
    names.onclick = (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;
        selected = MEMBERS.find((m) => m.id === Number(btn.dataset.id));
        showPad();
    };

    document.getElementById("pin-back").onclick = () => {
        selected = null; pin = "";
        document.getElementById("login-pin").hidden = true;
        names.hidden = false;
    };

    const pad = document.getElementById("pin-pad");
    pad.innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "⌫"]
        .map((k) => (k === "" ? "<span></span>" : `<button type="button" data-k="${k}">${k}</button>`))
        .join("");
    pad.onclick = (e) => {
        const k = e.target.closest("button")?.dataset.k;
        if (k === undefined) return;
        if (k === "⌫") pin = pin.slice(0, -1);
        else if (pin.length < 4) pin += k;
        drawDots();
        if (pin.length === 4) submit();
    };
}

function showPad() {
    pin = "";
    document.getElementById("login-names").hidden = true;
    document.getElementById("login-pin").hidden = false;
    document.getElementById("pin-user").textContent = selected.name;
    document.getElementById("pin-error").textContent = "";
    drawDots();
}

function drawDots() {
    document.getElementById("pin-dots").innerHTML =
        [0, 1, 2, 3].map((i) => `<span class="${i < pin.length ? "full" : ""}"></span>`).join("");
}

async function submit() {
    const err = document.getElementById("pin-error");
    err.textContent = "";
    try {
        const user = await api("/api/login", { method: "POST", body: { name: selected.name, pin } });
        enterApp(user);
    } catch (e) {
        pin = "";
        drawDots();
        err.textContent = e.status === 429 ? "Demasiados intentos, espera unos minutos" : "PIN incorrecto";
    }
}
