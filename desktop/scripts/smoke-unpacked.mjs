// Prueba de humo del paquete YA armado (out/win-unpacked), sin abrir ventana ni instalar nada: hace lo mismo que
// src/main.js — `prisma migrate deploy` y arrancar el backend con el node.exe EMPAQUETADO — pero con una base
// temporal. Comprueba que la base se migra, que /health y /system/info responden con la versión del paquete y modo
// desktop, y que argon2 (el addon nativo que mataba al backend con el Node de Electron) carga: si no, no hay login.
//
//   node scripts/smoke-unpacked.mjs
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RES = path.join(ROOT, "out", "win-unpacked", "resources");
const nodeExe = path.join(RES, "node", "node.exe");
const backend = path.join(RES, "backend");
const prisma = path.join(backend, "node_modules", "prisma", "build", "index.js");
const wanted = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const PORT = 4123;

for (const p of [nodeExe, prisma, path.join(backend, "dist", "index.js")]) {
  if (!fs.existsSync(p)) throw new Error(`falta ${p}: corre antes npm run pack / build:win`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pos-smoke-"));
const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(PORT),
  POS_MODE: "desktop",
  DATABASE_URL: `file:${path.join(tmp, "pos.db").replace(/\\/g, "/")}?connection_limit=1`,
  JWT_SECRET: "humo-" + Date.now(),
  POS_FRONTEND_DIST: path.join(RES, "frontend-dist"),
  POS_IMAGES_DIR: path.join(tmp, "images"),
};

let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? "OK   " : "FALLA"} ${msg}`); if (!ok) fail = 1; };

const mig = spawnSync(nodeExe, [prisma, "migrate", "deploy"], { cwd: backend, env, encoding: "utf8" });
check(mig.status === 0, `migrate deploy (código ${mig.status}) ${mig.status === 0 ? "" : (mig.stdout + mig.stderr).slice(-400)}`);

const child = spawn(nodeExe, [path.join(backend, "dist", "index.js")], { cwd: backend, env, stdio: ["ignore", "pipe", "pipe"] });
let out = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (out += d));
let exited = false;
child.on("exit", (c) => { exited = true; out += `\n[salió con código ${c}]`; });

const get = (p) => fetch(`http://127.0.0.1:${PORT}${p}`, { signal: AbortSignal.timeout(3000) });
let info = null;
for (let i = 0; i < 60 && !exited && !info; i++) {
  try { if ((await get("/health")).ok) info = await (await get("/system/info")).json(); } catch { /* aún no */ }
  if (!info) await new Promise((r) => setTimeout(r, 500));
}
check(!!info, "el backend responde /health y /system/info");
if (info) {
  check(info.mode === "desktop", `modo ${info.mode} (esperado desktop)`);
  check(info.version === wanted, `versión ${info.version} (esperada ${wanted})`);
  const spa = await get("/");
  check(spa.ok && (await spa.text()).includes("<div id="), "sirve la pantalla (frontend-dist)");
  // un login con datos inventados: 401/400 prueba que la ruta carga argon2 sin morir; un 500 o una caída no
  const login = await fetch(`http://127.0.0.1:${PORT}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "nadie", password: "x" }),
  });
  check(login.status >= 400 && login.status < 500 && !exited, `login inventado -> ${login.status}, backend sigue vivo`);
}
if (fail) console.log("--- salida del backend ---\n" + out.slice(-1500));
child.kill();
spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
await new Promise((r) => setTimeout(r, 500));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? "HAY FALLOS" : "TODO BIEN");
process.exit(fail);
