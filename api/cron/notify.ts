import { sql } from "../../lib/db";
import { sendPush } from "../../lib/push";

// GET /api/cron/notify — Vercel Cron diario. Avisa a cada suscriptor si tiene
// tareas vencidas o que vencen hoy (asignadas a él o sin asignar).
export async function GET(req: Request) {
    if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
        return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    // Hoy en CDMX (mismo criterio que el frontend)
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());

    const subs = await sql`
      SELECT s.id, s.endpoint, s.user_id,
             (SELECT count(*) FROM tasks t
              WHERE t.deleted_at IS NULL AND t.status != 'done'
                AND t.due_date <= ${today}
                AND (s.user_id = ANY(t.assignees) OR t.assignees = '{}')) AS due
      FROM push_subscriptions s`;

    let sent = 0, failed = 0;
    for (const s of subs) {
        if (Number(s.due) === 0) continue;
        (await sendPush(s)) ? sent++ : failed++;
    }
    return Response.json({ sent, failed });
}
