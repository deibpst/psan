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
