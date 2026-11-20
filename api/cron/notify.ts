import { sql } from "../../lib/db";
import { sendPush, reminder } from "../../lib/push";

// GET /api/cron/notify: Vercel Cron diario. Avisa a cada dispositivo suscrito si su
// usuario tiene tareas vencidas o que vencen hoy (asignadas a él o sin asignar).
// El texto se guarda como aviso por dispositivo; el push va vacío.
export async function GET(req: Request) {
    if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
        return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    // Hoy en CDMX (mismo criterio que el frontend)
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());

    const subs = await sql`
      SELECT s.id, s.endpoint, s.user_id, t.overdue, t.today, t.first
      FROM push_subscriptions s
      CROSS JOIN LATERAL (
        SELECT count(*) FILTER (WHERE due_date < ${today}) AS overdue,
               count(*) FILTER (WHERE due_date = ${today}) AS today,
               (array_agg(title ORDER BY due_date, created_at))[1] AS first
        FROM tasks
        WHERE deleted_at IS NULL AND status != 'done' AND due_date <= ${today}
          AND (s.user_id = ANY(assignees) OR assignees = '{}')
      ) t`;

    let sent = 0, failed = 0;
    for (const s of subs) {
        const r = reminder(Number(s.overdue), Number(s.today), s.first ?? "");
        if (!r) continue;
        await sql`INSERT INTO notifications (user_id, endpoint, title, body) VALUES (${s.user_id}, ${s.endpoint}, ${r.title}, ${r.body})`;
        (await sendPush(s)) ? sent++ : failed++;
    }
    return Response.json({ sent, failed });
}
