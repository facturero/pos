// Prueba del actualizador de punta a punta, sin VM: firma paquetes reales con sign-release.mjs,
// los sirve por HTTP local y corre update() sobre carpetas temporales.
//   node --test os/updater/updater.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { update, compareVersions, EXIT } from "./updater.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SIGN = path.join(here, "..", "release", "sign-release.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "facturero-upd-"));
const keys = path.join(tmp, "keys");
const publicKey = () => fs.readFileSync(path.join(keys, "release-public.pem"), "utf8");

let server, port, healthOk = true, healthHits = 0;
const web = path.join(tmp, "web"); // lo que "publica" el servidor de actualizaciones

const node = (args) => {
  const r = spawnSync(process.execPath, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stdout + r.stderr);
};

function publish(version, files = { "backend/index.js": `// ${version}` }, opts = {}) {
  const stage = path.join(tmp, `stage-${version}`);
  fs.rmSync(stage, { recursive: true, force: true });
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(stage, f)), { recursive: true });
    fs.writeFileSync(path.join(stage, f), c);
  }
  node([SIGN, "--version", version, "--stage", stage, "--out", web, "--url-base", `http://127.0.0.1:${port}`, "--key", path.join(keys, opts.key ?? "release-private.pem")]);
}

const cfg = (root, extra = {}) => ({
  root,
  manifestUrl: `http://127.0.0.1:${port}/latest.json`,
  publicKey: publicKey(),
  healthUrl: `http://127.0.0.1:${port}/health`,
  healthTimeoutMs: 2500,
  log: () => {},
  ...extra,
});
const newRoot = () => fs.mkdtempSync(path.join(tmp, "root-"));
const current = (root) => path.basename(fs.readlinkSync(path.join(root, "current")));

before(async () => {
  fs.mkdirSync(web, { recursive: true });
  node([SIGN, "--gen-keys", keys]);
  server = http.createServer((req, res) => {
    if (req.url === "/health") { healthHits++; res.writeHead(healthOk ? 200 : 500).end(); return; }
    const file = path.join(web, req.url.replace(/^\//, ""));
    if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200).end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test("compareVersions", () => {
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0"), 0);
  assert.equal(compareVersions("0.9.0", "1.0.0"), -1);
  assert.throws(() => compareVersions("1.x.0", "1.0.0"));
});

test("instalación inicial: descomprime, deja current y responde", async () => {
  healthOk = true;
  publish("1.0.0");
  const root = newRoot();
  const r = await update(cfg(root));
  assert.equal(r.code, EXIT.OK);
  assert.equal(current(root), "1.0.0");
  assert.equal(fs.readFileSync(path.join(root, "current", "backend", "index.js"), "utf8"), "// 1.0.0");
  assert.equal(fs.readFileSync(path.join(root, "current", "VERSION"), "utf8").trim(), "1.0.0");
});

test("actualiza a una versión nueva, corre migración y reinicio con RELEASE_VERSION", async () => {
  healthOk = true;
  publish("1.0.0");
  const root = newRoot();
  await update(cfg(root));
  publish("1.1.0");
  const marks = path.join(root, "marks.txt");
  const r = await update(cfg(root, {
    migrateCmd: `node -e "require('fs').appendFileSync(process.argv[1],'migrate '+process.env.RELEASE_VERSION+'\\n')" "${marks}"`,
    restartCmd: `node -e "require('fs').appendFileSync(process.argv[1],'restart '+process.env.RELEASE_VERSION+'\\n')" "${marks}"`,
  }));
  assert.equal(r.updated, true);
  assert.equal(current(root), "1.1.0");
  assert.equal(fs.readFileSync(marks, "utf8"), "migrate 1.1.0\nrestart 1.1.0\n");
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "state.json"), "utf8")).previous, "1.0.0");
});

test("misma versión: no hace nada", async () => {
  healthOk = true;
  publish("1.0.0");
  const root = newRoot();
  await update(cfg(root));
  const r = await update(cfg(root));
  assert.deepEqual([r.code, r.updated], [EXIT.OK, false]);
});

test("manifiesto firmado con OTRA clave se rechaza y no cambia nada", async () => {
  healthOk = true;
  publish("1.0.0");
  const root = newRoot();
  await update(cfg(root));
  const otras = path.join(tmp, "otras");
  node([SIGN, "--gen-keys", otras]);
  const stage = path.join(tmp, "stage-evil");
  fs.mkdirSync(stage, { recursive: true });
  fs.writeFileSync(path.join(stage, "x"), "x");
  node([SIGN, "--version", "9.9.9", "--stage", stage, "--out", web, "--url-base", `http://127.0.0.1:${port}`, "--key", path.join(otras, "release-private.pem")]);
  await assert.rejects(update(cfg(root)), /firma/);
  assert.equal(current(root), "1.0.0");
});

test("paquete alterado (sha256 distinto) se rechaza", async () => {
  healthOk = true;
  publish("1.0.0");
  const root = newRoot();
  await update(cfg(root));
  publish("1.2.0");
  const pkg = path.join(web, "facturero-pos-1.2.0.tar.gz");
  const bytes = fs.readFileSync(pkg);
  bytes[bytes.length - 20] ^= 0xff; // mismo tamaño, contenido distinto
  fs.writeFileSync(pkg, bytes);
  await assert.rejects(update(cfg(root)), /sha256/);
  assert.equal(current(root), "1.0.0");
  assert.equal(fs.existsSync(path.join(root, "releases", "1.2.0")), false);
});

test("si la versión nueva no responde, vuelve a la anterior y no la reintenta", async () => {
  healthOk = true;
  publish("1.0.0");
  const root = newRoot();
  await update(cfg(root));
  publish("1.3.0");
  healthOk = false;
  const marks = path.join(root, "marks.txt");
  const r = await update(cfg(root, { restartCmd: `node -e "require('fs').appendFileSync(process.argv[1],'restart '+process.env.RELEASE_VERSION+'\\n')" "${marks}"` }));
  assert.equal(r.code, EXIT.ROLLED_BACK);
  assert.equal(current(root), "1.0.0");
  assert.equal(fs.readFileSync(marks, "utf8"), "restart 1.3.0\nrestart 1.0.0\n"); // reinició con la nueva y otra vez con la anterior
  healthOk = true;
  const hitsBefore = healthHits;
  const again = await update(cfg(root));
  assert.equal(again.updated, false);
  assert.equal(healthHits, hitsBefore); // ni siquiera lo intentó
});

test("si falla la migración, se queda la versión actual y se borra la nueva", async () => {
  healthOk = true;
  publish("1.0.0");
  const root = newRoot();
  await update(cfg(root));
  publish("1.4.0");
  await assert.rejects(update(cfg(root, { migrateCmd: `node -e "process.exit(1)"` })), /migración/);
  assert.equal(current(root), "1.0.0");
  assert.equal(fs.existsSync(path.join(root, "releases", "1.4.0")), false);
});

test("conserva solo las últimas versiones (keepReleases) sin borrar current ni previous", async () => {
  healthOk = true;
  const root = newRoot();
  for (const v of ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]) {
    publish(v);
    await update(cfg(root, { keepReleases: 2 }));
  }
  const left = fs.readdirSync(path.join(root, "releases")).sort();
  assert.deepEqual(left, ["1.2.0", "1.3.0"]);
  assert.equal(current(root), "1.3.0");
});

test("dos actualizaciones a la vez: la segunda espera (lock)", async () => {
  healthOk = true;
  publish("1.0.0");
  const root = newRoot();
  fs.mkdirSync(path.join(root, "releases"), { recursive: true });
  fs.writeFileSync(path.join(root, "updater.lock"), "");
  const r = await update(cfg(root));
  assert.equal(r.code, EXIT.LOCKED);
});
