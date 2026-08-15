import { test, expect } from "bun:test";
import { createSession, destroySession, getUser, touchSession, TIMEOUT_MINUTES } from "./auth";
import { sql, migrate } from "./db";

test("getUser resuelve la sesión desde el header cookie", async () => {
    await migrate();

    const name = `test-${crypto.randomUUID()}`;
    const hash = await Bun.password.hash("0000");
    const [user] = await sql`
      INSERT INTO users (name, pin_hash) VALUES (${name}, ${hash})
      RETURNING id, name`;

    const token = await createSession(user.id);

    // cookie sola
    expect(await getUser(new Request("http://x/", { headers: { cookie: `session=${token}` } }))).toEqual(user);

    // cookie acompañada de otras (el orden no debe importar)
    expect(
        await getUser(new Request("http://x/", { headers: { cookie: `theme=dark; session=${token}; lang=es` } }))
    ).toEqual(user);

    // sin cookie
    expect(await getUser(new Request("http://x/"))).toBeNull();

    // token inválido
    expect(await getUser(new Request("http://x/", { headers: { cookie: "session=nope" } }))).toBeNull();

    await destroySession(token);
    expect(await getUser(new Request("http://x/", { headers: { cookie: `session=${token}` } }))).toBeNull();

    // limpieza
    await sql`DELETE FROM users WHERE name = ${name}`;
});

test("createSession sets expires_at in the future", async () => {
    await migrate();
    const name = `test-${crypto.randomUUID()}`;
    const hash = await Bun.password.hash("0000");
    const [user] = await sql`
      INSERT INTO users (name, pin_hash) VALUES (${name}, ${hash})
      RETURNING id, name`;

    const token = await createSession(user.id);
    const rows = await sql`SELECT expires_at FROM sessions WHERE token = ${token}`;
    expect(rows.length).toBe(1);
    expect(new Date(rows[0].expires_at).getTime()).toBeGreaterThan(Date.now());
    await sql`DELETE FROM sessions WHERE token = ${token}`;
    await sql`DELETE FROM users WHERE name = ${name}`;
});

test("getUser returns null for expired session and deletes the row", async () => {
    await migrate();
    const name = `test-${crypto.randomUUID()}`;
    const hash = await Bun.password.hash("0000");
    const [user] = await sql`
      INSERT INTO users (name, pin_hash) VALUES (${name}, ${hash})
      RETURNING id, name`;

    const token = await createSession(user.id);
    // expire it manually
    await sql`UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE token = ${token}`;

    const req = new Request("http://x/", { headers: { cookie: `session=${token}` } });
    expect(await getUser(req)).toBeNull();

    // row was cleaned up
    const remaining = await sql`SELECT 1 FROM sessions WHERE token = ${token}`;
    expect(remaining.length).toBe(0);

    await sql`DELETE FROM users WHERE name = ${name}`;
});

test("touchSession extends expires_at", async () => {
    await migrate();
    const name = `test-${crypto.randomUUID()}`;
    const hash = await Bun.password.hash("0000");
    const [user] = await sql`
      INSERT INTO users (name, pin_hash) VALUES (${name}, ${hash})
      RETURNING id, name`;

    const token = await createSession(user.id);
    const before = await sql`SELECT expires_at FROM sessions WHERE token = ${token}`;
    const beforeTime = new Date(before[0].expires_at).getTime();

    // wait a tiny bit so the clock moves, then touch
    await new Promise((r) => setTimeout(r, 50));
    await touchSession(token);

    const after = await sql`SELECT expires_at FROM sessions WHERE token = ${token}`;
    const afterTime = new Date(after[0].expires_at).getTime();
    expect(afterTime).toBeGreaterThan(beforeTime);

    await sql`DELETE FROM sessions WHERE token = ${token}`;
    await sql`DELETE FROM users WHERE name = ${name}`;
});

test("TIMEOUT_MINUTES es un entero positivo", () => {
    expect(Number.isInteger(TIMEOUT_MINUTES)).toBe(true);
    expect(TIMEOUT_MINUTES).toBeGreaterThan(0);
});
