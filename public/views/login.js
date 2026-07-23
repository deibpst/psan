import { api } from "/api.js";
import { MEMBERS, enterApp } from "/app.js";

// Página de acceso: dropdown de usuario → 4 casillas de PIN → flecha
export function renderLogin() {
    const select = document.getElementById("login-user");
    const boxesWrap = document.getElementById("pin-boxes");
    const boxes = [...boxesWrap.querySelectorAll("input")];
    const go = document.getElementById("login-go");
    const err = document.getElementById("pin-error");

    select.innerHTML =
        `<option value="" selected disabled>Elige tu nombre</option>` +
        MEMBERS.map((m) => `<option value="${m.name}">${m.name}</option>`).join("");

    const pin = () => boxes.map((b) => b.value).join("");
    const sync = () => { go.hidden = pin().length !== boxes.length; };
    const reset = () => { for (const b of boxes) b.value = ""; sync(); };

    select.onchange = () => {
        err.textContent = "";
        boxesWrap.hidden = false;
        reset();
        boxes[0].focus();
    };

    boxes.forEach((box, i) => {
        box.oninput = () => {
            box.value = box.value.replace(/\D/g, "").slice(-1);
            if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
            sync();
        };
        box.onkeydown = (e) => {
            if (e.key === "Backspace" && !box.value && i > 0) boxes[i - 1].focus();
        };
    });

    go.onclick = async () => {
        err.textContent = "";
        try {
            enterApp(await api("/api/login", { method: "POST", body: { name: select.value, pin: pin() } }));
        } catch (e) {
            reset();
            boxes[0].focus();
            err.textContent = e.status === 429 ? "Demasiados intentos, espera unos minutos" : "PIN incorrecto";
        }
    };
}
