import { sql } from "../lib/db";
import { getUser } from "../lib/auth";

// GET /api/push → clave pública VAPID (para pushManager.subscribe)
export async function GET() {
    return Response.json({ key: process.env.VAPID_PUBLIC_KEY ?? null });
}

// POST /api/push  { endpoint, keys: { p256dh, auth } }  (PushSubscription.toJSON())
export async function POST(req: Request) {
    const user = await getUser(req);
    if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as
        { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
    if (typeof body?.endpoint !== "string" || !body.endpoint.startsWith("https://") ||
        typeof body.keys?.p256dh !== "string" || typeof body.keys?.auth !== "string") {
        return Response.json({ error: "Suscripción inválida" }, { status: 400 });
    }

    await sql`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
      VALUES (${user.id}, ${body.endpoint}, ${body.keys.p256dh}, ${body.keys.auth})
      ON CONFLICT (endpoint) DO UPDATE
        SET user_id = ${user.id}, p256dh = ${body.keys.p256dh}, auth = ${body.keys.auth}`;

    return Response.json({ ok: true }, { status: 201 });
}

// DELETE /api/push  { endpoint }
export async function DELETE(req: Request) {
    const user = await getUser(req);
    if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
    if (typeof body?.endpoint !== "string") {
        return Response.json({ error: "Falta endpoint" }, { status: 400 });
    }

    await sql`DELETE FROM push_subscriptions WHERE endpoint = ${body.endpoint} AND user_id = ${user.id}`;
    return Response.json({ ok: true });
}
