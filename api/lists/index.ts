import { sql } from "../../lib/db";
import { getUser } from "../../lib/auth";

// GET /api/lists — listas con sus items
export async function GET(req: Request) {
    const user = await getUser(req);
    if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });

    const lists = await sql`
      SELECT l.*, u.name AS created_by_name,
             COALESCE(
               (SELECT json_agg(json_build_object(
                  'id', i.id, 'text', i.text, 'checked', i.checked,
                  'created_by', i.created_by, 'created_at', i.created_at
                ) ORDER BY i.created_at)
                FROM list_items i WHERE i.list_id = l.id),
               '[]'::json
             ) AS items
      FROM lists l
      JOIN users u ON u.id = l.created_by
      ORDER BY l.created_at`;

    return Response.json(lists);
}

// POST /api/lists  { name }
export async function POST(req: Request) {
    const user = await getUser(req);
    if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
    if (!body || typeof body.name !== "string" || !body.name.trim()) {
        return Response.json({ error: "Falta name" }, { status: 400 });
    }

    const [list] = await sql`
      INSERT INTO lists (name, created_by) VALUES (${body.name.trim()}, ${user.id})
      RETURNING *`;

    return Response.json(list, { status: 201 });
}
