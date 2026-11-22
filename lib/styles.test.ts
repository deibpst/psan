import { test, expect } from "bun:test";

// Los colores crudos viven solo en los bloques de tokens (:root y [data-theme]);
// los componentes usan var(--token), así cada tema puede redefinirlos.
test("styles.css: sin colores crudos fuera de los bloques de tokens", async () => {
    const css = (await Bun.file(import.meta.dir + "/../public/styles.css").text())
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(?::root|\[data-theme[^\]]*\])[^{]*\{[^}]*\}/g, "");
    const raw = css.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\bhsla?\(/gi) ?? [];
    expect(raw).toEqual([]);
});

// El theme-color de index.html (barra de estado del teléfono) debe ser el mismo color que --chrome (header sólido).
test("index.html: theme-color coincide con --chrome en claro y oscuro", async () => {
    const css = await Bun.file(import.meta.dir + "/../public/styles.css").text();
    const html = await Bun.file(import.meta.dir + "/../public/index.html").text();
    const chrome = [...css.matchAll(/--chrome:\s*(#[0-9A-Fa-f]{6})/g)].map((m) => m[1]!.toUpperCase());
    expect(chrome.length).toBe(2); // claro, oscuro
    for (const c of chrome) expect(html.toUpperCase()).toContain(`"${c}"`);
    expect(html.toUpperCase()).toContain(`CONTENT="${chrome[0]}"`);
});
