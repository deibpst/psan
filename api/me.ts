import { getUser } from "../lib/auth";

export async function GET(req: Request) {
    const user = await getUser(req);
    if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });
    return Response.json(user);
}
