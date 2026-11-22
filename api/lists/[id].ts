import { sql } from "../../lib/db";
import { getUser, touchSession, readSessionToken } from "../../lib/auth";

// DELETE /api/lists/:id  (borrado real: items y lista en un solo statement, list_items no tiene cascade)
export async function DELETE(req: Request) {
    const user = await getUser(req);
    if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });
    await touchSession(readSessionToken(req));

    const id = Number(new URL(req.url).pathname.split("/").pop());
    if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "id inválido" }, { status: 400 });

    const rows = await sql`
      WITH items AS (DELETE FROM list_items WHERE list_id = ${id})
      DELETE FROM lists WHERE id = ${id} RETURNING id`;

    if (rows.length === 0) return Response.json({ error: "Lista no encontrada" }, { status: 404 });
    return Response.json({ ok: true });
}
