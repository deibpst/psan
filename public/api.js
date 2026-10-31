// Wrapper mínimo de fetch: JSON siempre, 401 → recargar (vuelve al login)
export async function api(path, opts = {}) {
    const res = await fetch(path, {
        headers: { "content-type": "application/json" },
        ...opts,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401 && path !== "/api/me" && path !== "/api/login") {
        location.reload();
        return new Promise(() => {}); // nunca resuelve; la página se recarga
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error ?? "Error"), { status: res.status });
    return data;
}

// stale-while-revalidate por sección: caché al instante (o skeleton), revalida, repinta solo si cambió
const cache = new Map();      // path → JSON
const shown = new WeakMap();  // section → `${path}|${key}|${json}` pintado
const latest = new WeakMap(); // section → última petición; respuestas viejas se descartan
const issued = new Map();     // path → nº de la última petición; una respuesta vieja no pisa la caché
export async function swr(section, path, { paint, skeleton, key = "", quiet = false }) {
    const ticket = {}; latest.set(section, ticket);
    const n = (issued.get(path) ?? 0) + 1; issued.set(path, n);
    const hit = cache.get(path);
    let fromSkeleton = false;
    const show = (json) => {
        const tag = `${path}|${key}|${json}`;
        if (latest.get(section) !== ticket || shown.get(section) === tag) return;
        shown.set(section, tag);
        section.classList.toggle("settled", !fromSkeleton); // rise solo al salir del skeleton
        paint(JSON.parse(json));
    };
    if (!quiet) {
        if (hit) show(hit);
        else if (skeleton) { shown.delete(section); fromSkeleton = true; skeleton(); }
    }
    try {
        const json = JSON.stringify(await api(path));
        if (issued.get(path) === n) cache.set(path, json);
        show(json);
    } catch (e) {
        if (!hit || quiet) { shown.delete(section); throw e; } // con caché pintada, el fallo deja lo viejo
    }
}
