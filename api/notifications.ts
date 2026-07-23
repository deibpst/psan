import { sql } from "../lib/db";
import { getUser } from "../lib/auth";

// GET /api/notifications: entrega y marca los avisos pendientes del usuario.
// UPDATE…RETURNING: una sola pasada, sin carreras entre dispositivos.
export async function GET(req: Request) {
    const user = await getUser(req);
    if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });

    const rows = await sql`
      UPDATE notifications SET delivered_at = now()
      WHERE user_id = ${user.id} AND delivered_at IS NULL
      RETURNING body, created_at`;

    return Response.json(rows);
}
