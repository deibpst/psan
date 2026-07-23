import { sql } from "../../lib/db";
import { getUser } from "../../lib/auth";

const STATUSES = ["pending", "in_progress", "done"] as const;
export const RECURRENCES = ["daily", "weekly", "biweekly", "monthly"] as const;

// GET /api/tasks?status=&assigned_to=&from=&to=
export async function GET(req: Request) {
    const user = await getUser(req);
    if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });

    const p = new URL(req.url).searchParams;
    const status = p.get("status");
    const assignedTo = p.get("assigned_to");
    const from = p.get("from");
    const to = p.get("to");

    if (status && !STATUSES.includes(status as any)) {
        return Response.json({ error: "status inválido" }, { status: 400 });
    }

    const tasks = await sql`
      SELECT t.*,
             c.name  AS created_by_name,
             a.name  AS assigned_to_name,
             s.name  AS status_changed_by_name
      FROM tasks t
      JOIN users c ON c.id = t.created_by
      LEFT JOIN users a ON a.id = t.assigned_to
      LEFT JOIN users s ON s.id = t.status_changed_by
      WHERE t.deleted_at IS NULL
        AND (${status}::text IS NULL OR t.status = ${status})
        AND (${assignedTo}::int IS NULL OR t.assigned_to = ${assignedTo})
        AND (${from}::date IS NULL OR t.due_date >= ${from})
        AND (${to}::date IS NULL OR t.due_date <= ${to})
      ORDER BY t.due_date NULLS LAST, t.created_at DESC`;

    return Response.json(tasks);
}

// POST /api/tasks  { title, notes?, due_date?, assigned_to?, recurrence? }
export async function POST(req: Request) {
    const user = await getUser(req);
    if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as {
        title?: unknown;
        notes?: unknown;
        due_date?: unknown;
        assigned_to?: unknown;
        recurrence?: unknown;
    } | null;

    if (!body || typeof body.title !== "string" || !body.title.trim()) {
        return Response.json({ error: "Falta title" }, { status: 400 });
    }
    if (body.due_date != null && (typeof body.due_date !== "string" || isNaN(Date.parse(body.due_date)))) {
        return Response.json({ error: "due_date inválida (YYYY-MM-DD)" }, { status: 400 });
    }
    if (body.assigned_to != null && !Number.isInteger(body.assigned_to)) {
        return Response.json({ error: "assigned_to inválido" }, { status: 400 });
    }
    if (body.recurrence != null && !RECURRENCES.includes(body.recurrence as any)) {
        return Response.json({ error: "recurrence inválida" }, { status: 400 });
    }

    const [task] = await sql`
      INSERT INTO tasks (title, notes, due_date, assigned_to, recurrence, created_by)
      VALUES (
        ${body.title.trim()},
        ${typeof body.notes === "string" ? body.notes : null},
        ${(body.due_date as string | undefined) ?? null},
        ${(body.assigned_to as number | undefined) ?? null},
        ${(body.recurrence as string | undefined) ?? null},
        ${user.id}
      )
      RETURNING *`;

    return Response.json(task, { status: 201 });
}
