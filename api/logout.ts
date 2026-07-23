import { destroySession, readSessionToken } from "../lib/auth";

export async function POST(req: Request) {
    const token = readSessionToken(req);
    if (token) await destroySession(token);
    return Response.json(
        { ok: true },
        { headers: { "Set-Cookie": "session=; HttpOnly; Path=/; Max-Age=0" } }
    );
}
