import { sql, pgIntArray, normTask } from "../../lib/db";
import { getUser, touchSession, readSessionToken } from "../../lib/auth";
import { notifyUsers } from "../../lib/push";

const STATUSES = ["pending", "in_progress", "done"] as const;
export const RECURRENCES = ["daily", "weekly", "biweekly", "monthly"] as const;
export const isIdArray = (v: unknown): v is number[] =>
    Array.isArray(v) && v.every((n) => Number.isInteger(n) && n > 0);

// GET /api/tasks?status=&assigned_to=&from=&to=
export async function GET(req: Request) {
    const user = await getUser(req);
    if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });
    await touchSession(readSessionToken(req));

    const p = new URL(req.url).searchParams;
    const status = p.get("status");
    const assignedTo = p.get("assigned_to");
    const from = p.get("from");
    const to = p.get("to");

    if (status && !STATUSES.includes(status as any)) {
        return Response.json({ error: "status inválido" }, { status: 400 });
    }

    const tasks = await sql`
      SELECT t.*
      FROM tasks t
      WHERE t.deleted_at IS NULL
        AND (${status}::text IS NULL OR t.status = ${status})
        AND (${assignedTo}::int IS NULL OR ${assignedTo}::int = ANY(t.assignees))
        AND (${from}::date IS NULL OR t.due_date >= ${from})
        AND (${to}::date IS NULL OR t.due_date <= ${to})
      ORDER BY t.due_date NULLS LAST, t.created_at DESC`;

    return Response.json(tasks.map(normTask));
}

// POST /api/tasks  { title, notes?, due_date?, assignees?, recurrence? }
export async function POST(req: Request) {
    const user = await getUser(req);
    if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });
    await touchSession(readSessionToken(req));

    const body = (await req.json().catch(() => null)) as {
        title?: unknown;
        notes?: unknown;
        due_date?: unknown;
        assignees?: unknown;
        recurrence?: unknown;
    } | null;

    if (!body || typeof body.title !== "string" || !body.title.trim()) {
        return Response.json({ error: "Falta title" }, { status: 400 });
    }
    if (body.due_date != null && (typeof body.due_date !== "string" || isNaN(Date.parse(body.due_date)))) {
        return Response.json({ error: "due_date inválida (YYYY-MM-DD)" }, { status: 400 });
    }
    if (body.assignees != null && !isIdArray(body.assignees)) {
        return Response.json({ error: "assignees inválido" }, { status: 400 });
    }
    if (body.recurrence != null && !RECURRENCES.includes(body.recurrence as any)) {
        return Response.json({ error: "recurrence inválida" }, { status: 400 });
    }

    const [task] = await sql`
      INSERT INTO tasks (title, notes, due_date, assignees, recurrence, created_by)
      VALUES (
        ${body.title.trim()},
        ${typeof body.notes === "string" ? body.notes : null},
        ${(body.due_date as string | undefined) ?? null},
        ${pgIntArray((body.assignees as number[] | undefined) ?? [])}::int[],
        ${(body.recurrence as string | undefined) ?? null},
        ${user.id}
      )
      RETURNING *`;

    // Aviso solo a quienes quedaron asignados (no al autor)
    const assigned = ((body.assignees as number[] | undefined) ?? []).filter((id) => id !== user.id);
    await notifyUsers(assigned, `${user.name} te asignó: «${task.title}»`);

    return Response.json(normTask(task), { status: 201 });
}
