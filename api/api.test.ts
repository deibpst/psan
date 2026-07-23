import { test, expect, beforeAll, afterAll } from "bun:test";
import { sql, migrate } from "../lib/db";
import { createSession } from "../lib/auth";
import * as tasksIndex from "./tasks/index";
import * as taskById from "./tasks/[id]";
import * as listsIndex from "./lists/index";
import * as listItems from "./lists/[id]/items";
import * as push from "./push";
import * as cronNotify from "./cron/notify";
import * as notifications from "./notifications";

let userId: number;
let cookie: string;
let userId2: number;
let cookie2: string;
const cleanupTaskIds: number[] = [];
let testListId: number;

const json = (r: Response) => r.json() as Promise<any>;

function req(url: string, init: RequestInit = {}, auth = true): Request {
    return new Request(`http://x${url}`, {
        ...init,
        headers: {
            "content-type": "application/json",
            ...(auth ? { cookie } : {}),
            ...init.headers,
        },
    });
}

beforeAll(async () => {
    await migrate();
    const name = `test-${crypto.randomUUID()}`;
    const hash = await Bun.password.hash("0000");
    const [u] = await sql`INSERT INTO users (name, pin_hash) VALUES (${name}, ${hash}) RETURNING id`;
    userId = u.id;
    cookie = `session=${await createSession(userId)}`;
    const [u2] = await sql`INSERT INTO users (name, pin_hash) VALUES (${name + "-b"}, ${hash}) RETURNING id`;
    userId2 = u2.id;
    cookie2 = `session=${await createSession(userId2)}`;
});

afterAll(async () => {
    for (const id of cleanupTaskIds) {
        await sql`DELETE FROM task_revisions WHERE task_id = ${id}`;
        await sql`DELETE FROM tasks WHERE id = ${id}`;
    }
    if (testListId) {
        await sql`DELETE FROM list_items WHERE list_id = ${testListId}`;
        await sql`DELETE FROM lists WHERE id = ${testListId}`;
    }
    await sql`DELETE FROM notifications WHERE user_id IN (${userId}, ${userId2})`;
    await sql`DELETE FROM sessions WHERE user_id IN (${userId}, ${userId2})`;
    await sql`DELETE FROM users WHERE id IN (${userId}, ${userId2})`;
    await sql.end();
});

// ---------- tasks ----------

test("tasks: sin sesión → 401", async () => {
    expect((await tasksIndex.GET(req("/api/tasks", {}, false))).status).toBe(401);
    expect((await tasksIndex.POST(req("/api/tasks", { method: "POST", body: "{}" }, false))).status).toBe(401);
});

test("tasks: POST valida title", async () => {
    const res = await tasksIndex.POST(req("/api/tasks", { method: "POST", body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
});

test("tasks: crear, listar, editar (revisión + atribución de status), borrar", async () => {
    // crear
    const created = await tasksIndex.POST(
        req("/api/tasks", {
            method: "POST",
            body: JSON.stringify({ title: "Prueba", due_date: "2026-08-01" }),
        })
    );
    expect(created.status).toBe(201);
    const task = await json(created);
    cleanupTaskIds.push(task.id);
    expect(task.status).toBe("pending");

    // listar con filtro
    const list = await tasksIndex.GET(req("/api/tasks?from=2026-08-01&to=2026-08-01"));
    expect(list.status).toBe(200);
    const tasks = await json(list);
    expect(tasks.some((t: any) => t.id === task.id)).toBe(true);

    // status inválido
    const bad = await taskById.PATCH(
        req(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ status: "nope" }) })
    );
    expect(bad.status).toBe(400);

    // cambiar status → atribución
    const patched = await taskById.PATCH(
        req(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ status: "in_progress" }) })
    );
    expect(patched.status).toBe(200);
    const updated = await json(patched);
    expect(updated.status).toBe("in_progress");
    expect(updated.status_changed_by).toBe(userId);
    expect(updated.status_changed_at).not.toBeNull();

    // revisión guardada con la versión previa
    const revs = await sql`SELECT * FROM task_revisions WHERE task_id = ${task.id}`;
    expect(revs.length).toBe(1);
    const prev = typeof revs[0].previous === "string" ? JSON.parse(revs[0].previous) : revs[0].previous;
    expect(prev.status).toBe("pending");

    // borrado suave
    const del = await taskById.DELETE(req(`/api/tasks/${task.id}`, { method: "DELETE" }));
    expect(del.status).toBe(200);
    const after = await json(await tasksIndex.GET(req("/api/tasks?from=2026-08-01&to=2026-08-01")));
    expect(after.some((t: any) => t.id === task.id)).toBe(false);

    // PATCH sobre tarea borrada → 404
    const gone = await taskById.PATCH(
        req(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ title: "x" }) })
    );
    expect(gone.status).toBe(404);
});

// ---------- permisos y multi-asignación ----------

test("tasks: solo el creador puede eliminar", async () => {
    const created = await json(await tasksIndex.POST(
        req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "mía" }) })
    ));
    cleanupTaskIds.push(created.id);

    const ajeno = await taskById.DELETE(
        req(`/api/tasks/${created.id}`, { method: "DELETE", headers: { cookie: cookie2 } })
    );
    expect(ajeno.status).toBe(403);

    const propio = await taskById.DELETE(req(`/api/tasks/${created.id}`, { method: "DELETE" }));
    expect(propio.status).toBe(200);
});

test("tasks: assignees múltiples: crear, filtrar, reemplazar", async () => {
    const bad = await tasksIndex.POST(
        req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "x", assignees: ["a"] }) })
    );
    expect(bad.status).toBe(400);

    const created = await json(await tasksIndex.POST(
        req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "dúo", assignees: [userId, userId2] }) })
    ));
    cleanupTaskIds.push(created.id);
    expect(created.assignees).toEqual([userId, userId2]);

    // filtro por miembro dentro del array
    const filtered = await json(await tasksIndex.GET(req(`/api/tasks?assigned_to=${userId2}`)));
    expect(filtered.some((t: any) => t.id === created.id)).toBe(true);

    // PATCH reemplaza el array completo
    const patched = await json(await taskById.PATCH(
        req(`/api/tasks/${created.id}`, { method: "PATCH", body: JSON.stringify({ assignees: [userId2] }) })
    ));
    expect(patched.assignees).toEqual([userId2]);
});

// ---------- avisos por evento ----------

test("notifications: asignar, done ajeno, eliminar → avisos correctos", async () => {
    expect((await notifications.GET(req("/api/notifications", {}, false))).status).toBe(401);

    // user1 crea asignándola a user2 → aviso "te asignó" para user2
    const created = await json(await tasksIndex.POST(
        req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Aviso", assignees: [userId2] }) })
    ));
    cleanupTaskIds.push(created.id);

    // user2 la marca hecha → aviso "marcó como hecha" para user1 (creador)
    await taskById.PATCH(req(`/api/tasks/${created.id}`, {
        method: "PATCH", body: JSON.stringify({ status: "done" }), headers: { cookie: cookie2 },
    }));

    // user1 la elimina → aviso "eliminó" para user2
    await taskById.DELETE(req(`/api/tasks/${created.id}`, { method: "DELETE" }));

    const deUser2 = await json(await notifications.GET(
        req("/api/notifications", { headers: { cookie: cookie2 } })
    ));
    const bodies2 = deUser2.map((n: any) => n.body).join(" | ");
    expect(bodies2).toContain("te asignó");
    expect(bodies2).toContain("eliminó");
    expect(bodies2).toContain("«Aviso»");

    const deUser1 = await json(await notifications.GET(req("/api/notifications")));
    expect(deUser1.map((n: any) => n.body).join(" | ")).toContain("marcó como hecha");

    // segunda lectura: ya entregados → vacío
    expect((await json(await notifications.GET(req("/api/notifications")))).length).toBe(0);
});

// ---------- recurrence ----------

test("tasks: recurrence inválida → 400", async () => {
    const res = await tasksIndex.POST(
        req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "x", recurrence: "yearly" }) })
    );
    expect(res.status).toBe(400);
});

test("tasks: recurrente hecha → nace siguiente ocurrencia futura", async () => {
    const title = `rec-${crypto.randomUUID()}`;
    const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const created = await json(await tasksIndex.POST(
        req("/api/tasks", { method: "POST", body: JSON.stringify({ title, due_date: ayer, recurrence: "weekly" }) })
    ));
    cleanupTaskIds.push(created.id);
    expect(created.recurrence).toBe("weekly");

    const done = await taskById.PATCH(
        req(`/api/tasks/${created.id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) })
    );
    expect(done.status).toBe(200);

    const rows = await sql`SELECT * FROM tasks WHERE title = ${title} AND deleted_at IS NULL ORDER BY id`;
    expect(rows.length).toBe(2);
    const next = rows[1];
    cleanupTaskIds.push(next.id);
    expect(next.status).toBe("pending");
    expect(next.recurrence).toBe("weekly");
    const hoy = new Date().toISOString().slice(0, 10);
    expect(String(next.due_date).slice(0, 10) > hoy).toBe(true);
});

// ---------- push ----------

test("push: sin sesión → 401; suscribir/borrar ok", async () => {
    const sub = {
        endpoint: `https://example.com/psan-test-${crypto.randomUUID()}`,
        keys: { p256dh: "test", auth: "test" },
    };
    expect((await push.POST(req("/api/push", { method: "POST", body: JSON.stringify(sub) }, false))).status).toBe(401);

    const bad = await push.POST(req("/api/push", { method: "POST", body: JSON.stringify({ endpoint: "nope" }) }));
    expect(bad.status).toBe(400);

    expect((await push.POST(req("/api/push", { method: "POST", body: JSON.stringify(sub) }))).status).toBe(201);
    expect((await push.DELETE(req("/api/push", { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) }))).status).toBe(200);
});

test("cron: sin secreto → 401, con secreto → 200", async () => {
    expect((await cronNotify.GET(new Request("http://x/api/cron/notify"))).status).toBe(401);
    // corre contra datos reales: solo se valida forma, no cantidades
    const ok = await cronNotify.GET(new Request("http://x/api/cron/notify", {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }));
    expect(ok.status).toBe(200);
    const body = await json(ok);
    expect(typeof body.sent).toBe("number");
    expect(typeof body.failed).toBe("number");
});

// ---------- lists ----------

test("lists: sin sesión → 401", async () => {
    expect((await listsIndex.GET(req("/api/lists", {}, false))).status).toBe(401);
});

test("lists: crear lista, agregar/palomear/borrar items", async () => {
    const created = await listsIndex.POST(
        req("/api/lists", { method: "POST", body: JSON.stringify({ name: "Súper" }) })
    );
    expect(created.status).toBe(201);
    const list = await json(created);
    testListId = list.id;

    // item sin text → 400
    const bad = await listItems.POST(
        req(`/api/lists/${list.id}/items`, { method: "POST", body: JSON.stringify({}) })
    );
    expect(bad.status).toBe(400);

    // agregar item
    const itemRes = await listItems.POST(
        req(`/api/lists/${list.id}/items`, { method: "POST", body: JSON.stringify({ text: "Leche" }) })
    );
    expect(itemRes.status).toBe(201);
    const item = await json(itemRes);
    expect(item.checked).toBe(false);

    // palomear
    const checked = await listItems.PATCH(
        req(`/api/lists/${list.id}/items`, {
            method: "PATCH",
            body: JSON.stringify({ item_id: item.id, checked: true }),
        })
    );
    expect((await json(checked)).checked).toBe(true);

    // aparece en GET con items
    const all = await json(await listsIndex.GET(req("/api/lists")));
    const mine = all.find((l: any) => l.id === list.id);
    expect(mine.items.length).toBe(1);

    // borrar item
    const del = await listItems.DELETE(
        req(`/api/lists/${list.id}/items`, { method: "DELETE", body: JSON.stringify({ item_id: item.id }) })
    );
    expect(del.status).toBe(200);

    // lista inexistente → 404
    const notFound = await listItems.POST(
        req(`/api/lists/999999/items`, { method: "POST", body: JSON.stringify({ text: "x" }) })
    );
    expect(notFound.status).toBe(404);
});
