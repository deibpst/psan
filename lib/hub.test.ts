import { test, expect } from "bun:test";
import { GET, POST } from "../api/hub";

const r = (url: string, method = "GET") => new Request(`http://x${url}`, { method });

test("hub: op por query", async () => {
    const res = await GET(r("/api/hub?op=health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("x-hub-op")).toBe("health:query");
});

test("hub: sin op usa el último segmento del path", async () => {
    const res = await GET(r("/api/health"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-hub-op")).toBe("health:path");
});

test("hub: op desconocido 404, método no permitido 405", async () => {
    expect((await GET(r("/api/hub?op=nope"))).status).toBe(404);
    expect((await GET(r("/api/hub"))).status).toBe(404);
    expect((await POST(r("/api/hub?op=health", "POST"))).status).toBe(405);
});

// Cada op con su método, sin tocar la base: el handler responde antes de consultarla
test("hub: login, logout, me y notifications llegan a su handler", async () => {
    const post = (op: string, body?: unknown) => POST(new Request(`http://x/api/hub?op=${op}`, {
        method: "POST", body: body === undefined ? undefined : JSON.stringify(body),
    }));

    const login = await post("login", {});
    expect(login.status).toBe(400); // "Faltan name o pin"
    expect(login.headers.get("x-hub-op")).toBe("login:query");

    const logout = await post("logout");
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");

    const me = await GET(r("/api/hub?op=me"));
    expect(me.status).toBe(401); // sin cookie

    const notif = await post("notifications", {});
    expect(notif.status).toBe(400); // "Falta endpoint"
});

test("hub: método equivocado en cada op → 405", async () => {
    expect((await GET(r("/api/hub?op=login"))).status).toBe(405);
    expect((await GET(r("/api/hub?op=logout"))).status).toBe(405);
    expect((await POST(r("/api/hub?op=me", "POST"))).status).toBe(405);
    expect((await GET(r("/api/hub?op=notifications"))).status).toBe(405);
});

