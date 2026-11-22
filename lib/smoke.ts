// Humo de rutas contra un despliegue real: bun lib/smoke.ts https://<preview>.vercel.app
// Sin sesión ni datos: solo comprueba que cada método+URL llega a su handler (status esperado).
// No escribe nada: todas las peticiones fallan antes de tocar la base, salvo logout (solo borra cookie).
const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!base.startsWith("http")) { console.error("uso: bun lib/smoke.ts <url>"); process.exit(2); }

const cases: [string, string, number, unknown?][] = [
    ["GET", "/api/health", 200],
    ["GET", "/api/me", 401],
    ["POST", "/api/login", 400, {}],
    ["POST", "/api/logout", 200],
    ["POST", "/api/notifications", 400, {}],
    ["GET", "/api/push", 200],
    ["POST", "/api/push", 401, {}],
    ["DELETE", "/api/push", 401, {}],
    ["GET", "/api/tasks", 401],
    ["POST", "/api/tasks", 401, {}],
    ["PATCH", "/api/tasks/1", 401, {}],
    ["DELETE", "/api/tasks/1", 401],
    ["GET", "/api/lists", 401],
    ["POST", "/api/lists", 401, {}],
    ["PATCH", "/api/lists/1", 401, {}],
    ["DELETE", "/api/lists/1", 401],
    ["POST", "/api/lists/1/items", 401, {}],
    ["PATCH", "/api/lists/1/items", 401, {}],
    ["DELETE", "/api/lists/1/items", 401, {}],
    ["GET", "/api/cron/notify", 401],
    // rutas que ya no existen como archivo y no deben responder por accidente
    ["GET", "/api/hub", 404],
    ["GET", "/api/nope", 404],
];

let bad = 0;
for (const [method, path, want, body] of cases) {
    const res = await fetch(base + path, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const ok = res.status === want;
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${method.padEnd(6)} ${path.padEnd(24)} ${res.status} (esperado ${want}) ${res.headers.get("x-hub-op") ?? ""}`);
}
console.log(bad ? `\n${bad} fallo(s)` : "\ntodo bien");
process.exit(bad ? 1 : 0);
