import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_THEME, sanitizeTheme, themeAssets } from "./contract.js";
import { assetPath } from "./assets.js";
import { buildThemeRecord } from "./service.js";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("tema: sanear lo que manda el CRM", () => {
  it("un tema válido pasa tal cual", () => {
    assert.deepEqual(sanitizeTheme(clone(BUILTIN_THEME)), BUILTIN_THEME);
  });

  it("basura, null o un tipo equivocado dan el tema integrado completo", () => {
    for (const raw of [null, undefined, 42, "x", [], {}]) {
      assert.deepEqual(sanitizeTheme(raw), BUILTIN_THEME);
    }
  });

  it("un campo inválido cae a su valor por defecto y no arrastra al resto", () => {
    const raw = clone(BUILTIN_THEME) as unknown as Record<string, any>;
    raw.typography.fontFamily = "comic-sans";
    raw.typography.baseSize = 99;
    raw.shape.radius = "xl";
    raw.layout.catalogColumns = 9;
    raw.colors.light.primary = "rojo";
    raw.colors.light.text = "#ABCDEF";
    const t = sanitizeTheme(raw);
    assert.equal(t.typography.fontFamily, "system");
    assert.equal(t.typography.baseSize, 16);
    assert.equal(t.shape.radius, "xl"); // el válido se conserva
    assert.equal(t.layout.catalogColumns, "auto");
    assert.equal(t.colors.light.primary, BUILTIN_THEME.colors.light.primary);
    assert.equal(t.colors.light.text, "#abcdef"); // normalizado a minúsculas
  });

  it("ignora campos desconocidos (un CRM más nuevo que la caja)", () => {
    const raw = { ...clone(BUILTIN_THEME), futuro: { a: 1 }, layout: { ...BUILTIN_THEME.layout, nuevo: true } };
    const t = sanitizeTheme(raw) as unknown as Record<string, unknown>;
    assert.equal("futuro" in t, false);
    assert.equal("nuevo" in (t.layout as object), false);
  });

  it("nunca deja pasar un fileId que pueda salir del directorio de imágenes", () => {
    const raw = clone(BUILTIN_THEME) as unknown as Record<string, any>;
    raw.branding.logoFileId = "../../etc/passwd";
    raw.branding.logoDarkFileId = "abc";
    raw.branding.loginBackground = { type: "image", color: null, imageFileId: "..\\..\\x" };
    const t = sanitizeTheme(raw);
    assert.equal(t.branding.logoFileId, null);
    assert.equal(t.branding.logoDarkFileId, null);
    assert.deepEqual(t.branding.loginBackground, { type: "color", color: null, imageFileId: null });
    assert.equal(assetPath("../secreto"), null);
    assert.ok(assetPath("a1b2c3d4-e5f6"));
  });

  it("recorta el mensaje de bienvenida y descarta el vacío", () => {
    const raw = clone(BUILTIN_THEME) as unknown as Record<string, any>;
    raw.branding.welcomeMessage = "x".repeat(200);
    assert.equal(sanitizeTheme(raw).branding.welcomeMessage?.length, 80);
    raw.branding.welcomeMessage = "   ";
    assert.equal(sanitizeTheme(raw).branding.welcomeMessage, null);
  });

  it("las imágenes que se bajan salen del tema saneado, no de lo que diga el servidor", () => {
    const raw = clone(BUILTIN_THEME) as unknown as Record<string, any>;
    raw.branding.logoFileId = "11111111-aaaa";
    raw.branding.logoDarkFileId = "22222222-bbbb";
    raw.branding.loginBackground = { type: "image", color: null, imageFileId: "33333333-cccc" };
    assert.deepEqual(themeAssets(sanitizeTheme(raw)), [
      { role: "logo", fileId: "11111111-aaaa" },
      { role: "logoDark", fileId: "22222222-bbbb" },
      { role: "loginBackground", fileId: "33333333-cccc" },
    ]);
  });
});

describe("tema: registro que se guarda", () => {
  it("'usa el integrado' se guarda sin config", () => {
    const r = buildThemeRecord({ source: "builtin", themeId: null, name: null, version: 0, etag: '"x"', schemaVersion: 1, config: null });
    assert.equal(r.config, null);
    assert.equal(r.themeId, null);
    assert.equal(r.source, "builtin");
  });

  it("un tema del CRM se guarda saneado", () => {
    const r = buildThemeRecord({
      source: "point", themeId: "t1", name: "Barra", version: 4, etag: '"t1-4"', schemaVersion: 1,
      config: { mode: "dark", shape: { radius: "raro" } },
    });
    assert.equal(r.config?.mode, "dark");
    assert.equal(r.config?.shape.radius, "lg");
    assert.equal(r.name, "Barra");
  });

  it("un source desconocido se trata como integrado", () => {
    const r = buildThemeRecord({ source: "otro" as never, themeId: "t", name: "n", version: 1, etag: null, schemaVersion: 1, config: {} });
    assert.equal(r.source, "builtin");
  });
});
