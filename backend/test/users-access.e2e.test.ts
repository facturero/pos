// Prueba de integración AUTOMÁTICA de usuarios, roles, permisos y desactivación en la caja.
//
// No necesita el CRM real ni credenciales: levanta un CRM simulado en localhost (con la misma forma que auth-service:
// GET /users con `permissions`, GET /roles, GET /permissions, POST /auth/refresh, POST /auth/login), una base SQLite
// temporal con las migraciones REALES, y ejecuta el sync (`pullFromAdmin`) y las rutas de la caja (login y sesión)
// exactamente como en producción. Cada escenario cambia el estado del CRM simulado, sincroniza y comprueba qué puede
// hacer el usuario en la caja.
//
//   npm run test:e2e
import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import argon2 from "argon2";

const BACKEND = fileURLToPath(new URL("..", import.meta.url));
const EST = "est-1";
const POS = "pos:access";

// --- CRM simulado ------------------------------------------------------------------------------------------------------
interface CrmUser {
  id: string;
  username: string;
  email: string;
  status: "active" | "disabled";
  roles: string[];
  establishmentIds: string[];
  password: string; // en claro, solo para validar /auth/login
  passwordHash: string | null;
}
const crm = {
  users: [] as CrmUser[],
  roles: [] as { name: string; permissions: string[] }[],
  catalog: [POS, "invoice:read", "invoice:create"] as string[],
  sendUserPermissions: true, // false = auth-service anterior que no manda `permissions` con el usuario
  failRoles: false,
  failCatalog: false,
};
const permissionsOf = (u: CrmUser) =>
  [...new Set(u.roles.flatMap((r) => crm.roles.find((x) => x.name === r)?.permissions ?? []))].sort();

function fakeJwt(): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ country_code: "EC", exp: Math.floor(Date.now() / 1000) + 900 })}.x`;
}

let crmPort = 0;

function startCrm(): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://crm");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      switch (`${req.method} ${url.pathname}`) {
        case "POST /auth/refresh":
          return send(200, { accessToken: fakeJwt(), tokenType: "Bearer", expiresIn: 900, refreshToken: `rt-${Date.now()}` });
        case "POST /auth/login": {
          const u = crm.users.find((x) => x.email === body.email);
          return u && u.password === body.password ? send(200, { accessToken: "x" }) : send(401, { code: "INVALID_CREDENTIALS" });
        }
        case "GET /users": {
          const est = url.searchParams.get("establishmentId");
          const list = crm.users.filter((u) => !est || u.establishmentIds.includes(est) || u.roles.includes("Administrador"));
          return send(
            200,
            list.map((u) => ({
              id: u.id,
              username: u.username,
              email: u.email,
              fullName: u.username,
              status: u.status,
              roles: u.roles,
              ...(crm.sendUserPermissions ? { permissions: permissionsOf(u) } : {}),
              establishmentIds: u.establishmentIds,
              isOwner: false,
              hasPassword: u.passwordHash !== null,
              passwordHash: u.passwordHash,
            })),
          );
        }
        case "GET /roles":
          return crm.failRoles ? send(500, { code: "BOOM" }) : send(200, crm.roles);
        case "GET /permissions":
          return crm.failCatalog
            ? send(500, { code: "BOOM" })
            : send(200, crm.catalog.map((code) => ({ id: code, code, resource: "x", action: "y", description: null })));
        case "GET /categories":
        case "GET /customers":
          return send(200, []);
        case "GET /products":
          return send(200, { items: [], total: 0 });
        case "GET /countries/EC/tax-rates":
          return send(200, []);
        default:
          return send(404, { code: "NOT_FOUND" });
      }
    });
  });
  return new Promise((resolve) => server.listen(crmPort, "127.0.0.1", () => {
    crmPort = (server.address() as { port: number }).port;
    resolve(server);
  }));
}

// --- La caja -----------------------------------------------------------------------------------------------------------
type App = { request: (path: string, init?: RequestInit) => Promise<Response> };
let app: App;
let pull: () => Promise<unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
let tmp: string;
let crmServer: Server;
let hashA: string;
let hashB: string;

const PW = "clave-de-prueba-A";
const PW2 = "clave-de-prueba-B";
let seq = 0;

function addUser(roles: string[], over: Partial<CrmUser> = {}): CrmUser {
  seq += 1;
  const u: CrmUser = {
    id: `user-${seq}`,
    username: `USR${String(seq).padStart(4, "0")}`,
    email: `u${seq}@prueba.test`,
    status: "active",
    roles,
    establishmentIds: [EST],
    password: PW,
    passwordHash: hashA,
    ...over,
  };
  crm.users.push(u);
  return u;
}

async function login(u: { username: string }, password = PW) {
  const res = await app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: u.username, password }),
  });
  const body = (await res.json()) as { token?: string; error?: string; user?: { role: string } };
  return { status: res.status, ...body };
}

async function session(token: string | undefined, path = "/products") {
  const res = await app.request(path, { headers: { authorization: `Bearer ${token}` } });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return { status: res.status, error: body.error };
}

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "pos-e2e-"));
  crmServer = await startCrm();
  process.env.DATABASE_URL = `file:${join(tmp, "e2e.db")}`;
  process.env.ADMIN_API_BASE_URL = `http://127.0.0.1:${crmPort}`;
  process.env.JWT_SECRET = "secreto-de-prueba";
  // Migraciones REALES de la caja: si alguna se rompe, esta prueba falla.
  execFileSync(
    process.execPath,
    [join(BACKEND, "node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", join(BACKEND, "prisma/schema.prisma")],
    { env: process.env, stdio: "pipe" },
  );
  const { Hono } = await import("hono");
  ({ prisma } = await import("../src/db.js"));
  pull = (await import("../src/sync/pull.js")).pullFromAdmin;
  const h = new Hono();
  h.route("/auth", (await import("../src/routes/auth.routes.js")).authRoutes);
  h.route("/products", (await import("../src/routes/products.routes.js")).productRoutes);
  h.route("/sales", (await import("../src/routes/sales.routes.js")).saleRoutes);
  h.route("/cash-sessions", (await import("../src/routes/cash-sessions.routes.js")).cashSessionRoutes);
  app = h as unknown as App;
  await prisma.posConfig.create({ data: { id: 1, organizationId: "org-1", establishmentId: EST, emissionPointId: "ep-1", refreshToken: "rt-0" } });
  hashA = await argon2.hash(PW);
  hashB = await argon2.hash(PW2);
  crm.roles = [
    { name: "Administrador", permissions: [POS, "invoice:read", "invoice:create"] },
    { name: "Vendedor", permissions: [POS, "invoice:read"] },
    { name: "Solo lectura", permissions: ["invoice:read"] },
    { name: "Contador", permissions: ["invoice:read"] },
  ];
});

after(async () => {
  crmServer?.close();
  await prisma?.$disconnect?.();
  rmSync(tmp, { recursive: true, force: true });
});

describe("acceso a la caja por el permiso pos:access", () => {
  it("entra quien tiene el permiso (Vendedor, Administrador) y el rol de la caja sale del CRM", async () => {
    const v = addUser(["Vendedor"]);
    const a = addUser(["Administrador"]);
    await pull();
    const lv = await login(v);
    const la = await login(a);
    assert.equal(lv.status, 200);
    assert.equal(lv.user?.role, "CASHIER");
    assert.equal(la.status, 200);
    assert.equal(la.user?.role, "ADMIN");
    assert.equal((await session(lv.token)).status, 200);
  });

  it("NO entra quien no lo tiene (Solo lectura, Contador): 403 con un mensaje claro", async () => {
    const l = addUser(["Solo lectura"]);
    const c = addUser(["Contador"]);
    await pull();
    for (const u of [l, c]) {
      const r = await login(u);
      assert.equal(r.status, 403);
      assert.match(r.error ?? "", /acceso al POS/);
      assert.equal(r.token, undefined);
    }
  });

  it("decide el PERMISO y no el nombre del rol: un rol personalizado con pos:access entra", async () => {
    crm.roles.push({ name: "Cajero nocturno", permissions: [POS] });
    const u = addUser(["Cajero nocturno"]);
    await pull();
    assert.equal((await login(u)).status, 200);
  });

  it("varios roles suman permisos: Solo lectura + Vendedor entra", async () => {
    const u = addUser(["Solo lectura", "Vendedor"]);
    await pull();
    assert.equal((await login(u)).status, 200);
  });

  it("quitarle el permiso a un rol cierra la sesión ya abierta (401) y niega el login (403); devolverlo lo recupera", async () => {
    crm.roles.push({ name: "Rol temporal", permissions: [POS] });
    const u = addUser(["Rol temporal"]);
    await pull();
    const l = await login(u);
    assert.equal((await session(l.token)).status, 200);

    crm.roles.find((r) => r.name === "Rol temporal")!.permissions = ["invoice:read"];
    await pull();
    const s = await session(l.token);
    assert.equal(s.status, 401);
    assert.match(s.error ?? "", /acceso al POS/);
    assert.equal((await login(u)).status, 403);

    crm.roles.find((r) => r.name === "Rol temporal")!.permissions = [POS];
    await pull();
    assert.equal((await login(u)).status, 200);
  });

  it("sin `permissions` en el usuario (auth-service anterior) se calculan con los permisos de cada rol", async () => {
    crm.sendUserPermissions = false;
    const ok = addUser(["Vendedor"]);
    const no = addUser(["Solo lectura"]);
    await pull();
    crm.sendUserPermissions = true;
    assert.equal((await login(ok)).status, 200);
    assert.equal((await login(no)).status, 403);
  });
});

describe("desactivación y baja", () => {
  it("deshabilitar en el CRM: no entra y la sesión abierta recibe 401; habilitar lo recupera", async () => {
    const u = addUser(["Vendedor"]);
    await pull();
    const l = await login(u);
    assert.equal((await session(l.token)).status, 200);

    u.status = "disabled";
    await pull();
    assert.equal((await login(u)).status, 401);
    const s = await session(l.token);
    assert.equal(s.status, 401);
    assert.match(s.error ?? "", /desactivado/);

    u.status = "active";
    await pull();
    assert.equal((await login(u)).status, 200);
  });

  it("quitado del establecimiento de la caja (deja de aparecer en la lista): se desactiva y no entra", async () => {
    const u = addUser(["Vendedor"]);
    await pull();
    assert.equal((await login(u)).status, 200);
    u.establishmentIds = ["otro-establecimiento"];
    await pull();
    assert.equal((await login(u)).status, 401);
  });

  it("si la lista de usuarios llega vacía no se desactiva a nadie", async () => {
    const saved = [...crm.users];
    crm.users = [];
    await pull();
    crm.users = saved;
    const u = saved.find((x) => x.roles.includes("Administrador"))!;
    assert.equal((await login(u)).status, 200);
  });
});

describe("contraseñas", () => {
  it("cambiar la contraseña en el CRM: tras el sync entra la nueva y la vieja se rechaza", async () => {
    const u = addUser(["Vendedor"]);
    await pull();
    assert.equal((await login(u, PW)).status, 200);
    u.password = PW2;
    u.passwordHash = hashB;
    await pull();
    assert.equal((await login(u, PW2)).status, 200);
    assert.equal((await login(u, PW)).status, 401);
  });

  it("contraseña incorrecta: 401", async () => {
    const u = addUser(["Vendedor"]);
    await pull();
    assert.equal((await login(u, "otra-cosa")).status, 401);
  });

  it("usuario sin hash local pero con CRM disponible: se valida contra el CRM y se vincula; sin permiso, 403", async () => {
    const ok = addUser(["Vendedor"], { passwordHash: null });
    const no = addUser(["Solo lectura"], { passwordHash: null });
    await pull();
    assert.equal((await login(ok)).status, 200);
    assert.ok((await prisma.user.findUnique({ where: { username: ok.username } })).passwordHash, "se guardó el hash tras validar contra el CRM");
    assert.equal((await login(no)).status, 403);
  });
});

describe("compatibilidad y fallos del CRM", () => {
  it("CRM que aún no tiene pos:access en su catálogo: nadie queda fuera (ni Solo lectura)", async () => {
    const before = [...crm.catalog];
    crm.catalog = ["invoice:read", "invoice:create"];
    const u = addUser(["Solo lectura"]);
    await pull();
    crm.catalog = before;
    assert.equal((await login(u)).status, 200);
    await pull(); // el CRM ya lo conoce: se aplica
    assert.equal((await login(u)).status, 403);
  });

  it("si falla la consulta de roles o del catálogo no se tumba el sync: se conservan los permisos y un usuario nuevo queda sin acceso", async () => {
    const v = addUser(["Vendedor"]);
    const l = addUser(["Solo lectura"]);
    await pull();
    assert.equal((await login(v)).status, 200);
    crm.failCatalog = true;
    crm.sendUserPermissions = false;
    crm.failRoles = true;
    const nuevo = addUser(["Vendedor"]);
    await pull();
    crm.failCatalog = false;
    crm.sendUserPermissions = true;
    crm.failRoles = false;
    assert.equal((await login(v)).status, 200, "el que ya tenía acceso lo conserva");
    assert.equal((await login(l)).status, 403, "el que no lo tenía sigue sin él");
    assert.equal((await login(nuevo)).status, 403, "un usuario nuevo no hereda acceso a ciegas");
    await pull();
    assert.equal((await login(nuevo)).status, 200, "con el siguiente sync correcto queda bien");
  });

  it("sin conexión con el CRM: entra quien ya tiene hash local; quien no, recibe un mensaje claro", async () => {
    const withHash = addUser(["Vendedor"]);
    const withoutHash = addUser(["Vendedor"], { passwordHash: null });
    await pull();
    crmServer.close();
    await new Promise((r) => setTimeout(r, 100));
    try {
      assert.equal((await login(withHash)).status, 200);
      const r = await login(withoutHash);
      assert.equal(r.status, 401);
      assert.match(r.error ?? "", /Sin conexión con el CRM/);
    } finally {
      crmServer = await startCrm();
    }
  });

  it("usuario creado en la caja (sin dato de permisos) entra como siempre", async () => {
    await prisma.user.create({ data: { username: "LOCAL01", name: "Local", role: "CASHIER", passwordHash: hashA } });
    assert.equal((await login({ username: "LOCAL01" })).status, 200);
  });
});
