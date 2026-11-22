import { test, expect, beforeAll, afterAll } from "bun:test";
import { sql, migrate } from "./db";
import { createSession, TIMEOUT_MINUTES } from "./auth";
import { clip, reminder } from "./push";
import * as tasksIndex from "../api/tasks/index";
import * as taskById from "../api/tasks/[id]";
import * as listsIndex from "../api/lists/index";
import * as listItems from "../api/lists/[id]/items";
import * as listById from "../api/lists/[id]";
import * as push from "../api/push";
import * as cronNotify from "../api/cron/notify";
import * as notifications from "./handlers/notifications";
import * as me from "./handlers/me";

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
    await sql`DELETE FROM push_subscriptions WHERE user_id IN (${userId}, ${userId2})`;
    await sql`DELETE FROM sessions WHERE user_id IN (${userId}, ${userId2})`;
    await sql`DELETE FROM users WHERE id IN (${userId}, ${userId2})`;
    await sql.end();
});

// ---------- tasks ----------

test("tasks: sin sesión → 401", async () => {
    expect((await tasksIndex.GET(req("/api/tasks", {}, false))).status).toBe(401);
    expect((await tasksIndex.POST(req("/api/tasks", { method: "POST", body: "{}" }, false))).status).toBe(401);
});

test("sesión expirada → 401 en todos los endpoints protegidos", async () => {
    // crear sesión temporal y expirarla
    const name = `expire-${crypto.randomUUID()}`;
    const hash = await Bun.password.hash("0000");
    const [u] = await sql`INSERT INTO users (name, pin_hash) VALUES (${name}, ${hash}) RETURNING id`;
    const token = await createSession(u.id);
    await sql`UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE token = ${token}`;
    const expiredCookie = `session=${token}`;

    const r = (path: string, init: RequestInit = {}) =>
        new Request(`http://x${path}`, { ...init, headers: { "content-type": "application/json", cookie: expiredCookie, ...init.headers } });

    expect((await tasksIndex.GET(r("/api/tasks"))).status).toBe(401);
    expect((await tasksIndex.POST(r("/api/tasks", { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await me.GET(r("/api/me"))).status).toBe(401);
    expect((await listsIndex.GET(r("/api/lists"))).status).toBe(401);

    // cleanup
    await sql`DELETE FROM sessions WHERE token = ${token}`;
    await sql`DELETE FROM users WHERE name = ${name}`;
});

test("acceso a endpoint extiende expires_at", async () => {
    const name = `touch-${crypto.randomUUID()}`;
    const hash = await Bun.password.hash("0000");
    const [u] = await sql`INSERT INTO users (name, pin_hash) VALUES (${name}, ${hash}) RETURNING id`;
    const token = await createSession(u.id);
    const before = await sql`SELECT expires_at FROM sessions WHERE token = ${token}`;
    const beforeTime = new Date(before[0].expires_at).getTime();

    await new Promise((r) => setTimeout(r, 50));
    const r = (path: string) =>
        new Request(`http://x${path}`, { headers: { "content-type": "application/json", cookie: `session=${token}` } });
    await tasksIndex.GET(r("/api/tasks"));

    const after = await sql`SELECT expires_at FROM sessions WHERE token = ${token}`;
    expect(new Date(after[0].expires_at).getTime()).toBeGreaterThan(beforeTime);

    await sql`DELETE FROM sessions WHERE token = ${token}`;
    await sql`DELETE FROM users WHERE name = ${name}`;
});

test("/api/me devuelve inactivityTimeoutMinutes y extiende sesión", async () => {
    const res = await me.GET(req("/api/me"));
    expect(res.status).toBe(200);
    const body = await res.json() as { id: number; name: string; inactivityTimeoutMinutes: number };
    expect(body.inactivityTimeoutMinutes).toBe(TIMEOUT_MINUTES);
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

test("notifications: un aviso por dispositivo, sin sesión; sin push no hay filas", async () => {
    const post = (endpoint: unknown) => notifications.POST(
        req("/api/notifications", { method: "POST", body: JSON.stringify({ endpoint }) }, false));
    expect((await post(undefined)).status).toBe(400);

    // user2 con 2 dispositivos; user1 sin push
    const [ep1, ep2] = [1, 2].map(() => `https://example.com/psan-test-${crypto.randomUUID()}`);
    for (const ep of [ep1, ep2]) {
        await sql`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (${userId2}, ${ep}, 't', 't')`;
    }

    // user1 crea asignándola a user2 → aviso "te pasó una tarea" en cada dispositivo de user2
    const created = await json(await tasksIndex.POST(
        req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Aviso", assignees: [userId2] }) })
    ));
    cleanupTaskIds.push(created.id);

    // user2 la marca hecha → aviso para user1 (creador), que no tiene push: sin filas
    await taskById.PATCH(req(`/api/tasks/${created.id}`, {
        method: "PATCH", body: JSON.stringify({ status: "done" }), headers: { cookie: cookie2 },
    }));

    // user1 la devuelve a pendiente → aviso "marcó ... como pendiente" para user2
    await taskById.PATCH(req(`/api/tasks/${created.id}`, { method: "PATCH", body: JSON.stringify({ status: "pending" }) }));

    // user1 la elimina → "Se eliminó" para user2
    await taskById.DELETE(req(`/api/tasks/${created.id}`, { method: "DELETE" }));

    for (const ep of [ep1, ep2]) {
        const rows = await json(await post(ep));
        const bodies = rows.map((n: any) => `${n.title}: ${n.body}`).join(" | ");
        expect(bodies).toContain("Nueva tarea: ");
        expect(bodies).toContain("te asignó: Aviso");
        expect(bodies).toContain("Tarea pendiente: ");
        expect(bodies).toContain("marcó: Aviso como pendiente");
        expect(bodies).toContain("Tarea eliminada: ");
        expect(bodies).toContain("eliminó: Aviso");
        expect((await json(await post(ep))).length).toBe(0); // ya entregados
    }
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${userId}`;
    expect(n).toBe(0);
});

test("textos: clip a 60 y recordatorio diario", () => {
    expect(clip("a".repeat(61))).toBe("a".repeat(59) + "…");
    expect(clip("corto")).toBe("corto");
    expect(reminder(0, 0, "")).toBeNull();
    expect(reminder(0, 1, "Cita OLAB")).toEqual({ title: "Tareas de hoy", body: "Buen día, hoy toca: Cita OLAB" });
    expect(reminder(0, 3, "Cita OLAB")!.body).toBe("Hoy toca: Cita OLAB y 2 más");
    expect(reminder(1, 0, "x")).toEqual({ title: "Tareas vencidas", body: "Hay 1 tarea vencida" });
    expect(reminder(2, 0, "x")!.body).toBe("Hay 2 tareas vencidas");
    expect(reminder(1, 2, "x")!.body).toBe("Hay 1 tarea vencida y 2 para hoy");
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

test("lists: eliminar lista con items", async () => {
    const list = await json(await listsIndex.POST(
        req("/api/lists", { method: "POST", body: JSON.stringify({ name: "Borrar" }) })
    ));
    await listItems.POST(
        req(`/api/lists/${list.id}/items`, { method: "POST", body: JSON.stringify({ text: "a" }) })
    );

    expect((await listById.DELETE(req(`/api/lists/${list.id}`, { method: "DELETE" }, false))).status).toBe(401);
    expect((await listById.DELETE(req(`/api/lists/${list.id}`, { method: "DELETE" }))).status).toBe(200);

    const all = await json(await listsIndex.GET(req("/api/lists")));
    expect(all.some((l: any) => l.id === list.id)).toBe(false);
    const left = await sql`SELECT 1 FROM list_items WHERE list_id = ${list.id}`;
    expect(left.length).toBe(0);

    expect((await listById.DELETE(req(`/api/lists/${list.id}`, { method: "DELETE" }))).status).toBe(404);
    expect((await listById.DELETE(req(`/api/lists/abc`, { method: "DELETE" }))).status).toBe(400);
});

test("lists: marcar hecha y reabrir", async () => {
    const list = await json(await listsIndex.POST(
        req("/api/lists", { method: "POST", body: JSON.stringify({ name: "Hecha" }) })
    ));
    const patch = (id: unknown, body: unknown, auth = true) =>
        listById.PATCH(req(`/api/lists/${id}`, { method: "PATCH", body: JSON.stringify(body) }, auth));

    expect((await patch(list.id, { done: true }, false)).status).toBe(401);
    expect((await patch(list.id, {})).status).toBe(400);
    expect((await patch("abc", { done: true })).status).toBe(400);
    expect((await patch(999999, { done: true })).status).toBe(404);

    const done = await json(await patch(list.id, { done: true }));
    expect(done.done_at).not.toBeNull();
    const all = await json(await listsIndex.GET(req("/api/lists")));
    expect(all.find((l: any) => l.id === list.id).done_at).not.toBeNull();

    const reopened = await json(await patch(list.id, { done: false }));
    expect(reopened.done_at).toBeNull();

    await sql`DELETE FROM lists WHERE id = ${list.id}`;
});

// ---------- avisos de listas ----------

// user2 con un dispositivo suscrito; user1 (quien actúa) con otro: no debe recibir nada
const notifyEp = { u1: `https://example.com/psan-test-${crypto.randomUUID()}`, u2: `https://example.com/psan-test-${crypto.randomUUID()}` };
const pending = async (ep: string) => (await json(await notifications.POST(
    req("/api/notifications", { method: "POST", body: JSON.stringify({ endpoint: ep }) }, false)))) as { title: string; body: string }[];

async function subscribeBoth() {
    for (const [uid, ep] of [[userId, notifyEp.u1], [userId2, notifyEp.u2]] as const) {
        await sql`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (${uid}, ${ep}, 't', 't') ON CONFLICT DO NOTHING`;
    }
}

test("avisos de listas: crear lista avisa a los demás, no a quien la crea", async () => {
    await subscribeBoth();
    const name = `Aviso-${crypto.randomUUID().slice(0, 6)}`;
    const list = await json(await listsIndex.POST(req("/api/lists", { method: "POST", body: JSON.stringify({ name }) })));
    const rows = (await pending(notifyEp.u2)).filter((n) => n.body.endsWith(name));
    expect(rows.length).toBe(1);
    expect(rows[0]!.title).toBe("Nueva lista");
    expect(rows[0]!.body).toMatch(/^test-.* creó la lista: /);
    expect((await pending(notifyEp.u1)).length).toBe(0);
    await sql`DELETE FROM lists WHERE id = ${list.id}`;
});

test("avisos de listas: agregar item avisa y agrupa ráfagas", async () => {
    await subscribeBoth();
    const name = `Aviso-${crypto.randomUUID().slice(0, 6)}`;
    const list = await json(await listsIndex.POST(req("/api/lists", { method: "POST", body: JSON.stringify({ name }) })));
    await pending(notifyEp.u2); // descarta el aviso de "Nueva lista"

    const add = (text: string, cookieOverride?: string) => listItems.POST(req(`/api/lists/${list.id}/items`, {
        method: "POST", body: JSON.stringify({ text }), ...(cookieOverride ? { headers: { cookie: cookieOverride } } : {}),
    }));
    for (const t of ["Leche", "Huevos", "Pan"]) expect((await add(t)).status).toBe(201);

    // 3 items seguidos = 1 solo aviso, con el primer item
    const rows = await pending(notifyEp.u2);
    expect(rows.length).toBe(1);
    expect(rows[0]!.title).toBe("Lista actualizada");
    expect(rows[0]!.body).toMatch(new RegExp(`^test-.* agregó Leche a: ${name}$`));
    expect((await pending(notifyEp.u1)).length).toBe(0);

    // otra persona agregando a la misma lista sí avisa (a user1)
    await add("Sal", cookie2);
    const u1rows = await pending(notifyEp.u1);
    expect(u1rows.length).toBe(1);
    expect(u1rows[0]!.body).toMatch(new RegExp(`^test-.*-b agregó Sal a: ${name}$`));
    await sql`DELETE FROM list_items WHERE list_id = ${list.id}`;
    await sql`DELETE FROM lists WHERE id = ${list.id}`;
});

test("avisos de listas: marcar terminada avisa; reabrir no", async () => {
    await subscribeBoth();
    const name = `Aviso-${crypto.randomUUID().slice(0, 6)}`;
    const list = await json(await listsIndex.POST(req("/api/lists", { method: "POST", body: JSON.stringify({ name }) })));
    await pending(notifyEp.u2);

    const patch = (done: boolean) => listById.PATCH(req(`/api/lists/${list.id}`, { method: "PATCH", body: JSON.stringify({ done }) }));
    await patch(true);
    const rows = await pending(notifyEp.u2);
    expect(rows.length).toBe(1);
    expect(rows[0]!.title).toBe("Lista terminada");
    expect(rows[0]!.body).toMatch(new RegExp(`^test-.* marcó como terminada la lista: ${name}$`));
    expect((await pending(notifyEp.u1)).length).toBe(0);

    await patch(false); // reabrir: en silencio
    expect((await pending(notifyEp.u2)).length).toBe(0);
    await sql`DELETE FROM lists WHERE id = ${list.id}`;
});

test("avisos de listas: eliminar avisa a los demás con el nombre", async () => {
    await subscribeBoth();
    const name = `Aviso-${crypto.randomUUID().slice(0, 6)}`;
    const list = await json(await listsIndex.POST(req("/api/lists", { method: "POST", body: JSON.stringify({ name }) })));
    await pending(notifyEp.u2);

    expect((await listById.DELETE(req(`/api/lists/${list.id}`, { method: "DELETE" }))).status).toBe(200);
    const rows = await pending(notifyEp.u2);
    expect(rows.length).toBe(1);
    expect(rows[0]!.title).toBe("Lista eliminada");
    expect(rows[0]!.body).toMatch(new RegExp(`^test-.* eliminó la lista: ${name}$`));
    expect((await pending(notifyEp.u1)).length).toBe(0);

    // lista inexistente: sin aviso
    expect((await listById.DELETE(req(`/api/lists/${list.id}`, { method: "DELETE" }))).status).toBe(404);
    expect((await pending(notifyEp.u2)).length).toBe(0);
});

