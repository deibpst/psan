import { sql } from "../../../lib/db";
import { getUser, touchSession, readSessionToken } from "../../../lib/auth";
import { notifyItemAdded } from "../../../lib/push";

function listId(req: Request): number | null {
    // /api/lists/:id/items → penúltimo segmento
    const parts = new URL(req.url).pathname.split("/");
    const id = Number(parts[parts.length - 2]);
    return Number.isInteger(id) && id > 0 ? id : null;
}

async function listName(id: number): Promise<string | null> {
    const rows = await sql`SELECT name FROM lists WHERE id = ${id}`;
    return rows[0]?.name ?? null;
}

// POST /api/lists/:id/items  { text }
export async function POST(req: Request) {
    const user = await getUser(req);
    if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });
    await touchSession(readSessionToken(req));

    const id = listId(req);
    if (!id) return Response.json({ error: "id inválido" }, { status: 400 });
    const name = await listName(id);
    if (name === null) return Response.json({ error: "Lista no encontrada" }, { status: 404 });

    const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
    if (!body || typeof body.text !== "string" || !body.text.trim()) {
        return Response.json({ error: "Falta text" }, { status: 400 });
    }

    const [item] = await sql`
      INSERT INTO list_items (list_id, text, created_by)
      VALUES (${id}, ${body.text.trim()}, ${user.id})
      RETURNING *`;

    await notifyItemAdded(user, name, item.text);

    return Response.json(item, { status: 201 });
}

// PATCH /api/lists/:id/items  { item_id, checked?, text? }
export async function PATCH(req: Request) {
    const user = await getUser(req);
    if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });
    await touchSession(readSessionToken(req));

    const id = listId(req);
    if (!id) return Response.json({ error: "id inválido" }, { status: 400 });

    const body = (await req.json().catch(() => null)) as {
        item_id?: unknown;
        checked?: unknown;
        text?: unknown;
    } | null;

    if (!body || !Number.isInteger(body.item_id)) {
        return Response.json({ error: "Falta item_id" }, { status: 400 });
    }
    if (body.checked !== undefined && typeof body.checked !== "boolean") {
        return Response.json({ error: "checked inválido" }, { status: 400 });
    }
    if (body.text !== undefined && (typeof body.text !== "string" || !body.text.trim())) {
        return Response.json({ error: "text inválido" }, { status: 400 });
    }

    const [item] = await sql`
      UPDATE list_items SET
        checked = COALESCE(${(body.checked as boolean | undefined) ?? null}, checked),
        text    = COALESCE(${(body.text as string | undefined)?.trim() ?? null}, text)
      WHERE id = ${body.item_id} AND list_id = ${id}
      RETURNING *`;

    if (!item) return Response.json({ error: "Item no encontrado" }, { status: 404 });
    return Response.json(item);
}

// DELETE /api/lists/:id/items  { item_id }
export async function DELETE(req: Request) {
    const user = await getUser(req);
    if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });
    await touchSession(readSessionToken(req));

    const id = listId(req);
    if (!id) return Response.json({ error: "id inválido" }, { status: 400 });

    const body = (await req.json().catch(() => null)) as { item_id?: unknown } | null;
    if (!body || !Number.isInteger(body.item_id)) {
        return Response.json({ error: "Falta item_id" }, { status: 400 });
    }

    const rows = await sql`
      DELETE FROM list_items WHERE id = ${body.item_id} AND list_id = ${id} RETURNING id`;

    if (rows.length === 0) return Response.json({ error: "Item no encontrado" }, { status: 404 });
    return Response.json({ ok: true });
}
