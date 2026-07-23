import { sql } from "../lib/db";
import { createSession } from "../lib/auth";

const MAX_FAILURES = 5;
const WINDOW_MINUTES = 15;

export async function POST(req: Request) {
    const body = (await req.json().catch(() => null)) as { name?: unknown; pin?: unknown } | null;
    const { name, pin } = body ?? {};

    if (typeof name !== "string" || typeof pin !== "string") {
        return Response.json({ error: "Faltan name o pin" }, { status: 400 });
    }

    // ponytail: rate limit por nombre, no por IP, suficiente para 3 usuarios conocidos
    const [{ count }] = await sql`
      SELECT count(*)::int AS count FROM login_attempts
      WHERE name = ${name} AND failed_at > now() - ${WINDOW_MINUTES} * interval '1 minute'`;

    if (count >= MAX_FAILURES) {
        return Response.json(
            { error: "Demasiados intentos, espera unos minutos" },
            { status: 429 }
        );
    }

    const rows = await sql`SELECT id, name, pin_hash FROM users WHERE name = ${name}`;
    const user = rows[0] as { id: number; name: string; pin_hash: string } | undefined;

    if (!user || !(await Bun.password.verify(pin, user.pin_hash))) {
        await sql`INSERT INTO login_attempts (name) VALUES (${name})`;
        return Response.json({ error: "Credenciales inválidas" }, { status: 401 });
    }

    await sql`DELETE FROM login_attempts WHERE name = ${name}`;
    const token = await createSession(user.id);

    return Response.json(
        { id: user.id, name: user.name },
        {
            headers: {
                "Set-Cookie": `session=${token}; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=2592000`,
            },
        }
    );
}
