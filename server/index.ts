import { db } from "./db";

const server = Bun.serve({
    port: 3000,
    async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/api/health") {
            return Response.json({ ok: true });
        }

        if (url.pathname === "/api/login" && req.method === "POST") {
            const { name, pin } = await req.json();

            const user = db
                .query("SELECT id, name, pin_hash FROM users WHERE name = ?")
                .get(name) as { id: number; name: string; pin_hash: string } | null;

            if (!user || !(await Bun.password.verify(pin, user.pin_hash))) {
                return Response.json({ error: "Credenciales inválidas" }, { status: 401 });
            }

            return Response.json({ id: user.id, name: user.name });
        }

        return new Response("Not found", { status: 404 });
    },
});

console.log(`Escuchando en http://localhost:${server.port}`);