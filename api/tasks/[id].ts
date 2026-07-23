import { sql } from "../../lib/db";
import { getUser } from "../../lib/auth";

const STATUSES = ["pending", "in_progress", "done"] as const;

function taskId(req: Request): number | null {
    const id = Number(new URL(req.url).pathname.split("/").pop());
    return Number.isInteger(id) && id > 0 ? id : null;
}

async function findTask(id: number) {
    const rows = await sql`SELECT * FROM tasks WHERE id = ${id} AND deleted_at IS NULL`;
    return rows[0] ?? null;
}

// PATCH /api/tasks/:id  { title?, notes?, due_date?, assigned_to?, status? }
export async function PATCH(req: Request) {
    const user = await getUser(req);
    if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });

    const id = taskId(req);
    if (!id) return Response.json({ error: "id inválido" }, { status: 400 });

    const task = await findTask(id);
    if (!task) return Response.json({ error: "Tarea no encontrada" }, { status: 404 });

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: "Body inválido" }, { status: 400 });

    if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim())) {
        return Response.json({ error: "title inválido" }, { status: 400 });
    }
    if (body.status !== undefined && !STATUSES.includes(body.status as any)) {
        return Response.json({ error: "status inválido" }, { status: 400 });
    }
    if (body.due_date !== undefined && body.due_date !== null &&
        (typeof body.due_date !== "string" || isNaN(Date.parse(body.due_date)))) {
        return Response.json({ error: "due_date inválida (YYYY-MM-DD)" }, { status: 400 });
    }
    if (body.assigned_to !== undefined && body.assigned_to !== null && !Number.isInteger(body.assigned_to)) {
        return Response.json({ error: "assigned_to inválido" }, { status: 400 });
    }

    // Auditoría: guarda la versión previa completa antes de tocarla
    await sql`
      INSERT INTO task_revisions (task_id, changed_by, previous)
      VALUES (${id}, ${user.id}, ${JSON.stringify(task)}::jsonb)`;

    const statusChanged = body.status !== undefined && body.status !== task.status;

    // Postgres devuelve DATE/TIMESTAMPTZ como Date; hay que re-enviarlos en formato ISO
    const asDateStr = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v as string | null));
    const asTimestamp = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));

    const [updated] = await sql`
      UPDATE tasks SET
        title             = COALESCE(${(body.title as string | undefined)?.trim() ?? null}, title),
        notes             = ${body.notes !== undefined ? (body.notes as string | null) : task.notes},
        due_date          = ${body.due_date !== undefined ? (body.due_date as string | null) : asDateStr(task.due_date)},
        assigned_to       = ${body.assigned_to !== undefined ? (body.assigned_to as number | null) : task.assigned_to},
        status            = COALESCE(${(body.status as string | undefined) ?? null}, status),
        status_changed_by = ${statusChanged ? user.id : task.status_changed_by},
        status_changed_at = ${statusChanged ? new Date().toISOString() : asTimestamp(task.status_changed_at)},
        updated_at        = now()
      WHERE id = ${id}
      RETURNING *`;

    return Response.json(updated);
}

// DELETE /api/tasks/:id  (borrado suave)
export async function DELETE(req: Request) {
    const user = await getUser(req);
    if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });

    const id = taskId(req);
    if (!id) return Response.json({ error: "id inválido" }, { status: 400 });

    const task = await findTask(id);
    if (!task) return Response.json({ error: "Tarea no encontrada" }, { status: 404 });

    await sql`
      INSERT INTO task_revisions (task_id, changed_by, previous)
      VALUES (${id}, ${user.id}, ${JSON.stringify(task)}::jsonb)`;

    await sql`UPDATE tasks SET deleted_at = now(), updated_at = now() WHERE id = ${id}`;

    return Response.json({ ok: true });
}
