import { test, expect } from "bun:test";
import { createSession, destroySession, getUser } from "./auth";
import { db } from "./db";

test("getUser resuelve la sesión desde el header cookie", () => {
    const user = db.query("SELECT id, name FROM users LIMIT 1").get() as { id: number; name: string };
    const token = createSession(user.id);

    // cookie sola
    expect(getUser(new Request("http://x/", { headers: { cookie: `session=${token}` } }))).toEqual(user);

    // cookie acompañada de otras (el orden no debe importar)
    expect(
        getUser(new Request("http://x/", { headers: { cookie: `theme=dark; session=${token}; lang=es` } }))
    ).toEqual(user);

    // sin cookie
    expect(getUser(new Request("http://x/"))).toBeNull();

    // token inválido
    expect(getUser(new Request("http://x/", { headers: { cookie: "session=nope" } }))).toBeNull();

    destroySession(token);
    expect(getUser(new Request("http://x/", { headers: { cookie: `session=${token}` } }))).toBeNull();
});
