import { db } from "./db";
import { createSession, destroySession, getUser } from "./auth";

const server = Bun.serve({
    port: 3000,
    async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/api/health") {
            return Response.json({ ok: true });
        }

        if (url.pathname === "/api/login" && req.method === "POST") {
            const body = (await req.json().catch(() => null)) as { name?: unknown; pin?: unknown } | null;
            const { name, pin } = body ?? {};

            if (typeof name !== "string" || typeof pin !== "string") {
                return Response.json({ error: "Faltan name o pin" }, { status: 400 });
            }

            const user = db
                .query("SELECT id, name, pin_hash FROM users WHERE name = ?")
                .get(name) as { id: number; name: string; pin_hash: string } | null;

            if (!user || !(await Bun.password.verify(pin, user.pin_hash))) {
                return Response.json({ error: "Credenciales inválidas" }, { status: 401 });
            }

            const token = createSession(user.id);

            return Response.json(
                { id: user.id, name: user.name },
                {
                    headers: {
                        "Set-Cookie": `session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`,
                    },
                }
            );
        }

        if (url.pathname === "/api/logout" && req.method === "POST") {
            const token = req.headers.get("cookie")?.match(/session=([^;]+)/)?.[1];
            if (token) destroySession(token);
            return Response.json(
                { ok: true },
                { headers: { "Set-Cookie": "session=; HttpOnly; Path=/; Max-Age=0" } }
            );
        }

        if (url.pathname === "/api/me") {
            const user = getUser(req);
            if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });
            return Response.json(user);
        }

        return new Response("Not found", { status: 404 });
    },
});

console.log(`Escuchando en http://localhost:${server.port}`);