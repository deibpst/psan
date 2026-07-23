import { test, expect } from "bun:test";
import { createSession, destroySession, getUser } from "./auth";
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
