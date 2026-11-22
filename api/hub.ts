// Un solo function para varias URLs (Hobby: máx. 12). vercel.json reescribe /api/<x> → /api/hub?op=<x>.
// Los handlers viven en lib/handlers/ (no cuentan como function) y se cargan solo cuando se usan,
// así un import roto en uno no tira a los demás.
const ops: Record<string, () => Promise<Record<string, (req: Request) => Response | Promise<Response>>>> = {
    health: () => import("../lib/handlers/health"),
    login: () => import("../lib/handlers/login"),
    logout: () => import("../lib/handlers/logout"),
    me: () => import("../lib/handlers/me"),
    notifications: () => import("../lib/handlers/notifications"),
};

async function hub(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // op por query (rewrite); si Vercel la pierde, último segmento del path original
    const viaQuery = url.searchParams.get("op");
    const op = viaQuery ?? url.pathname.split("/").pop() ?? "";
    const load = ops[op];
    if (!load) return Response.json({ error: "No encontrado" }, { status: 404 });
    const handler = (await load())[req.method];
    if (!handler) return Response.json({ error: "Método no permitido" }, { status: 405 });
    const res = await handler(req);
    res.headers.set("x-hub-op", `${op}:${viaQuery ? "query" : "path"}`); // prueba: qué mecanismo llegó
    return res;
}

export const GET = hub;
export const POST = hub;
export const PATCH = hub;
export const DELETE = hub;
