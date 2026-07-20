import { db } from "./db";
const server = Bun.serve({
    port: 3000,
    fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/api/health") {
            return Response.json({ ok: true });
        }

        return new Response("Not found", { status: 404 });
    },
});

console.log(`Escuchando en http://localhost:${server.port}`);