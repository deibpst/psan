import { test, expect } from "bun:test";
import { api, swr } from "../public/api.js";

// fake mínimo: swr solo necesita classList.toggle sobre la sección
function fakeSection() {
    return { classList: { toggle() {} } };
}

function okRes(data: unknown) {
    return { status: 200, ok: true, json: async () => data };
}

// hace que fetch resuelva, en orden, con cada uno de los JSON dados
function mockFetchSeq(dataList: unknown[]) {
    let i = 0;
    (globalThis as any).fetch = async () => okRes(dataList[i++]);
}

test("miss: no hay caché, pinta skeleton y luego pinta el dato", async () => {
    const section = fakeSection();
    let skeletonCalls = 0;
    let painted: unknown = null;
    mockFetchSeq([{ a: 1 }]);

    await swr(section, "/t-miss", {
        skeleton: () => { skeletonCalls++; },
        paint: (d) => { painted = d; },
    });

    expect(skeletonCalls).toBe(1);
    expect(painted).toEqual({ a: 1 });
});

test("hit con el mismo dato: pinta una sola vez, sin repintar", async () => {
    const section = fakeSection();
    let paints = 0;
    mockFetchSeq([{ a: 1 }, { a: 1 }]);
    const opts = { skeleton: () => {}, paint: () => { paints++; } };

    await swr(section, "/t-hit-igual", opts);
    await swr(section, "/t-hit-igual", opts);

    expect(paints).toBe(1);
});

test("hit con dato cambiado: repinta", async () => {
    const section = fakeSection();
    const painted: unknown[] = [];
    mockFetchSeq([{ v: "a" }, { v: "b" }]);
    const opts = { skeleton: () => {}, paint: (d: unknown) => painted.push(d) };

    await swr(section, "/t-hit-cambia", opts);
    await swr(section, "/t-hit-cambia", opts);

    expect(painted).toEqual([{ v: "a" }, { v: "b" }]);
});

test("respuesta vieja se descarta tras una llamada más nueva", async () => {
    const section = fakeSection();
    const painted: unknown[] = [];
    let calls = 0;
    (globalThis as any).fetch = async () => {
        calls++;
        if (calls === 1) {
            // la primera llamada es lenta: resuelve después de la segunda
            await new Promise((r) => setTimeout(r, 20));
            return okRes({ v: "vieja" });
        }
        return okRes({ v: "nueva" });
    };
    const opts = { skeleton: () => {}, paint: (d: unknown) => painted.push(d) };

    const stale = swr(section, "/t-stale", opts); // arranca, lenta, no se espera aún
    await swr(section, "/t-stale", opts);         // termina antes, pinta "nueva"
    await stale;                                   // resuelve tarde, se debe ignorar

    expect(painted).toEqual([{ v: "nueva" }]);
});

test("fetch falla con hit en caché: no lanza", async () => {
    const section = fakeSection();
    mockFetchSeq([{ v: "ok" }]);
    const opts = { skeleton: () => {}, paint: () => {} };
    await swr(section, "/t-falla-hit", opts); // deja algo en caché

    (globalThis as any).fetch = async () => { throw new Error("red caída"); };
    let threw = false;
    try {
        await swr(section, "/t-falla-hit", opts);
    } catch {
        threw = true;
    }
    expect(threw).toBe(false);
});

test("fetch falla sin hit en caché: lanza", async () => {
    const section = fakeSection();
    (globalThis as any).fetch = async () => { throw new Error("red caída"); };
    let threw = false;
    try {
        await swr(section, "/t-falla-sin-hit", { skeleton: () => {}, paint: () => {} });
    } catch {
        threw = true;
    }
    expect(threw).toBe(true);
});

test("quiet: no pinta skeleton ni lo viejo, solo el dato fresco", async () => {
    const section = fakeSection();
    let skeletonCalls = 0;
    const painted: unknown[] = [];
    mockFetchSeq([{ v: "vieja" }]);
    await swr(section, "/t-quiet", { skeleton: () => { skeletonCalls++; }, paint: (d) => painted.push(d) });
    expect(painted).toEqual([{ v: "vieja" }]);

    skeletonCalls = 0;
    painted.length = 0;
    mockFetchSeq([{ v: "nueva" }]);
    await swr(section, "/t-quiet", {
        skeleton: () => { skeletonCalls++; },
        paint: (d) => painted.push(d),
        quiet: true,
    });

    expect(skeletonCalls).toBe(0);
    expect(painted).toEqual([{ v: "nueva" }]); // nunca pintó la vieja camino al dato fresco
});

test("respuesta vieja que llega tarde no pisa la caché", async () => {
    const painted: unknown[] = [];
    let calls = 0;
    (globalThis as any).fetch = async () => {
        calls++;
        if (calls === 1) {
            await new Promise((r) => setTimeout(r, 20)); // lenta, resuelve al final
            return okRes({ v: "vieja" });
        }
        return okRes({ v: "nueva" });
    };
    const opts = { skeleton: () => {}, paint: (d: unknown) => painted.push(d) };

    // dos secciones distintas, mismo path: ninguna descarta a la otra por ticket
    const slow = swr(fakeSection(), "/t-cache-orden", opts);
    await swr(fakeSection(), "/t-cache-orden", opts);
    await slow;

    painted.length = 0;
    (globalThis as any).fetch = async () => { throw new Error("red caída"); };
    await swr(fakeSection(), "/t-cache-orden", opts); // hit: pinta lo cacheado, el fallo se ignora

    expect(painted).toEqual([{ v: "nueva" }]);
});

test("api rechaza cuando fetch nunca resuelve y la señal aborta", async () => {
    (globalThis as any).fetch = (_path: string, init: any) =>
        new Promise((_, reject) => {
            init.signal.addEventListener("abort", () => reject(init.signal.reason));
        });

    let threw = false;
    try {
        await api("/t-timeout", { signal: AbortSignal.timeout(10) });
    } catch (e: any) {
        threw = true;
        expect(e.name).toBe("TimeoutError");
    }
    expect(threw).toBe(true);
});
