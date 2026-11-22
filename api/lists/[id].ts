import { sql } from "../../lib/db";
import { getUser, touchSession, readSessionToken } from "../../lib/auth";

const listId = (req: Request) => {
    const id = Number(new URL(req.url).pathname.split("/").pop());
    return Number.isInteger(id) && id > 0 ? id : null;
};

// PATCH /api/lists/:id  { done: boolean }  → marca o reabre la lista
export async function PATCH(req: Request) {
    const user = await getUser(req);
    if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });
    await touchSession(readSessionToken(req));

    const id = listId(req);
    if (!id) return Response.json({ error: "id inválido" }, { status: 400 });

    const body = (await req.json().catch(() => null)) as { done?: unknown } | null;
    if (!body || typeof body.done !== "boolean") return Response.json({ error: "Falta done" }, { status: 400 });

    const rows = await sql`
      UPDATE lists SET done_at = CASE WHEN ${body.done}::boolean THEN now() ELSE NULL END WHERE id = ${id} RETURNING *`;

    if (rows.length === 0) return Response.json({ error: "Lista no encontrada" }, { status: 404 });
    return Response.json(rows[0]);
}

// DELETE /api/lists/:id  (borrado real: items y lista en un solo statement, list_items no tiene cascade)
export async function DELETE(req: Request) {
    const user = await getUser(req);
    if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });
    await touchSession(readSessionToken(req));

    const id = listId(req);
    if (!id) return Response.json({ error: "id inválido" }, { status: 400 });

    const rows = await sql`
      WITH items AS (DELETE FROM list_items WHERE list_id = ${id})
      DELETE FROM lists WHERE id = ${id} RETURNING id`;

    if (rows.length === 0) return Response.json({ error: "Lista no encontrada" }, { status: 404 });
    return Response.json({ ok: true });
}
