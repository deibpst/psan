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
