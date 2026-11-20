import { sql } from "../lib/db";

// POST /api/notifications  { endpoint }: entrega y marca los avisos pendientes de ese
// dispositivo. Sin sesión a propósito: el service worker corre con la sesión caducada
// y el endpoint de push (URL inadivinable) identifica al dispositivo.
// UPDATE…RETURNING: una sola pasada, sin carreras.
export async function POST(req: Request) {
    const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
    if (typeof body?.endpoint !== "string" || !body.endpoint.startsWith("https://")) {
        return Response.json({ error: "Falta endpoint" }, { status: 400 });
    }

    const rows = await sql`
      WITH d AS (
        UPDATE notifications SET delivered_at = now()
        WHERE endpoint = ${body.endpoint} AND delivered_at IS NULL
        RETURNING body, created_at)
      SELECT body, created_at FROM d ORDER BY created_at`;

    return Response.json(rows);
}
