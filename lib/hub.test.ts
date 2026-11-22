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
