import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

// Sincronización del tema de punta a punta contra un "CRM" simulado (HTTP real): ETag/304, descarga
// de imágenes de marca, tema que cambia, CRM anterior a los temas (404) y borrado al desvincular.
// Usa una base SQLite temporal con las migraciones de verdad (prisma migrate deploy).

const dir = mkdtempSync(path.join(tmpdir(), "pos-theme-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.POS_THEME_ASSETS_DIR = path.join(dir, "assets");

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
const LOGO = "11111111-aaaa-bbbb";

// Lo que responde el CRM simulado; cada prueba lo cambia.
let crm: { status: 200 | 404; etag: string; body: object } = { status: 404, etag: "", body: {} };
let seenIfNoneMatch: string | undefined;
let server: Server;

type Svc = typeof import("./service.js");
type Db = typeof import("../db.js");
let svc: Svc;
let db: Db;

const theme = (over: object = {}, logo: string | null = LOGO) => ({
  mode: "dark",
  layout: { cartPosition: "left" },
  colors: { dark: { primary: "#f59e0b" } },
  branding: { logoFileId: logo, welcomeMessage: "Hola" },
  ...over,
});

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const json = (code: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(code, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/auth/refresh") {
      return json(200, { accessToken: "a.b.c", tokenType: "Bearer", expiresIn: 3600, refreshToken: "r2" });
    }
    if (url.pathname === "/establishments/e1/billing-points/p1/theme") {
      seenIfNoneMatch = req.headers["if-none-match"] as string | undefined;
      if (crm.status === 404) return json(404, { message: "no existe" });
      if (seenIfNoneMatch && seenIfNoneMatch === crm.etag) {
        res.writeHead(304);
        return res.end();
      }
      return json(200, crm.body, { etag: crm.etag });
    }
    if (url.pathname.startsWith("/files/") && url.pathname.endsWith("/url")) {
      const id = url.pathname.split("/")[2];
      const { port } = server.address() as AddressInfo;
      return json(200, { url: `http://127.0.0.1:${port}/blob/${id}`, mimeType: "image/svg+xml" });
    }
    if (url.pathname.startsWith("/blob/")) {
      res.writeHead(200, { "content-type": "image/svg+xml" });
      return res.end(svg);
    }
    return json(404, {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.ADMIN_API_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "pipe", shell: process.platform === "win32", env: process.env });
  db = await import("../db.js");
  svc = await import("./service.js");
  await db.prisma.posConfig.create({
    data: { id: 1, organizationId: "o", establishmentId: "e1", emissionPointId: "p1", refreshToken: "r" },
  });
});

after(async () => {
  await db.prisma.$disconnect();
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

const remote = (over: Record<string, unknown>) => ({
  source: "default", themeId: "t1", name: "Tienda", version: 1, etag: '"t1-1"', schemaVersion: 1, config: theme(), ...over,
});

describe("tema: sincronización con el CRM", () => {
  it("un CRM anterior a los temas (404) no cambia nada y no falla", async () => {
    crm = { status: 404, etag: "", body: {} };
    assert.deepEqual(await svc.syncTheme(), { changed: false });
    assert.equal((await svc.getCurrentTheme()).config, null);
  });

  it("baja el tema, lo sanea y descarga la imagen de marca", async () => {
    crm = { status: 200, etag: '"t1-1"', body: remote({}) };
    assert.deepEqual(await svc.syncTheme(), { changed: true });
    const t = await svc.getCurrentTheme();
    assert.equal(t.source, "default");
    assert.equal(t.name, "Tienda");
    assert.equal(t.config?.mode, "dark");
    assert.equal(t.config?.layout.cartPosition, "left");
    assert.equal(t.config?.colors.dark.primary, "#f59e0b");
    assert.equal(t.config?.colors.dark.background, "#0f172a"); // lo que faltaba, del integrado
    assert.deepEqual(t.assets, [{ role: "logo", url: `/theme/assets/${LOGO}` }]);
    assert.ok(existsSync(path.join(process.env.POS_THEME_ASSETS_DIR!, LOGO)));
  });

  it("sin cambios manda If-None-Match y el CRM contesta 304", async () => {
    assert.deepEqual(await svc.syncTheme(), { changed: false });
    assert.equal(seenIfNoneMatch, '"t1-1"');
  });

  it("un tema nuevo reemplaza al anterior y la imagen que ya no se usa se borra del disco", async () => {
    crm = { status: 200, etag: '"t1-2"', body: remote({ version: 2, etag: '"t1-2"', config: theme({ mode: "light" }, null) }) };
    assert.deepEqual(await svc.syncTheme(), { changed: true });
    const t = await svc.getCurrentTheme();
    assert.equal(t.version, 2);
    assert.equal(t.config?.mode, "light");
    assert.deepEqual(t.assets, []);
    assert.equal(existsSync(path.join(process.env.POS_THEME_ASSETS_DIR!, LOGO)), false);
  });

  it("si el CRM se cae después, la caja conserva la copia local", async () => {
    crm = { status: 404, etag: "", body: {} };
    await svc.syncTheme();
    assert.equal((await svc.getCurrentTheme()).config?.mode, "light");
  });

  it("'usa el integrado' deja la caja sin config propia", async () => {
    crm = { status: 200, etag: '"b-0"', body: remote({ source: "builtin", themeId: null, name: null, version: 0, etag: '"b-0"', config: null }) };
    assert.deepEqual(await svc.syncTheme(), { changed: true });
    const t = await svc.getCurrentTheme();
    assert.equal(t.source, "builtin");
    assert.equal(t.config, null);
  });

  it("las rutas locales sirven el tema y solo las imágenes que el tema declara", async () => {
    crm = { status: 200, etag: '"t1-3"', body: remote({ version: 3, etag: '"t1-3"' }) };
    await svc.syncTheme();
    const { themeRoutes } = await import("../routes/theme.routes.js");

    const res = await themeRoutes.request("/");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { config: { mode: string }; assets: { url: string }[] };
    assert.equal(body.config.mode, "dark");
    assert.equal(body.assets[0].url, `/theme/assets/${LOGO}`);

    const img = await themeRoutes.request(`/assets/${LOGO}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/svg+xml");
    assert.match(img.headers.get("content-security-policy") ?? "", /sandbox/);
    assert.equal(img.headers.get("x-content-type-options"), "nosniff");

    assert.equal((await themeRoutes.request("/assets/99999999-zzzz-aaaa")).status, 404); // no declarada
    assert.equal((await themeRoutes.request("/assets/..%2F..%2Fsecreto")).status, 404); // fuera del directorio
  });

  it("al desvincular se borra el tema y las imágenes", async () => {
    assert.ok(existsSync(path.join(process.env.POS_THEME_ASSETS_DIR!, LOGO)));
    await svc.clearTheme();
    assert.equal((await svc.getCurrentTheme()).config, null);
    assert.equal(existsSync(process.env.POS_THEME_ASSETS_DIR!), false);
  });
});
