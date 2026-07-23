import { test, expect, beforeAll, afterAll } from "bun:test";
import { sql, migrate } from "../lib/db";
import { createSession } from "../lib/auth";
import * as tasksIndex from "./tasks/index";
import * as taskById from "./tasks/[id]";
import * as listsIndex from "./lists/index";
import * as listItems from "./lists/[id]/items";

let userId: number;
let cookie: string;
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
    await sql`DELETE FROM sessions WHERE user_id = ${userId}`;
    await sql`DELETE FROM users WHERE id = ${userId}`;
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
