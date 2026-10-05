import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { runGate } from "./update-gate.mjs";

// Backend simulado: `script` es la lista de respuestas para /system/update-gate (la última se repite);
// "404" imita a un backend <= 0.3.4 que no tiene el endpoint.
let server, port, script, calls;
let tmp;
before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
  server = http.createServer((req, res) => {
    if (req.url !== "/system/update-gate") { res.writeHead(404); res.end(); return; }
    calls += 1;
    const next = script.length > 1 ? script.shift() : script[0];
    if (next === "404") { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(next));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

function setup(responses) {
  script = [...responses];
  calls = 0;
  const stateDir = fs.mkdtempSync(path.join(tmp, "state-"));
  const releaseRoot = fs.mkdtempSync(path.join(tmp, "rel-"));
  return {
    stateDir,
    releaseRoot,
    opts: { stateDir, releaseRoot, baseUrl: `http://127.0.0.1:${port}`, pollMs: 20, version: "1.1.0", log: () => {} },
  };
}
const status = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "update-gate.json"), "utf8"));

test("es seguro desde el primer momento: se aplica sin esperar y deja la marca", async () => {
  const { stateDir, opts } = setup([{ safe: true, reason: "caja cerrada" }]);
  const r = await runGate(opts);
  assert.equal(r.applied, true);
  assert.equal(status(stateDir).state, "applying");
  assert.equal(fs.existsSync(path.join(stateDir, "update-gate-ok")), true);
});

test("no es seguro: espera, deja el estado 'waiting' visible y aplica cuando lo es", async () => {
  const { stateDir, opts } = setup([
    { safe: false, reason: "venta en curso" },
    { safe: false, reason: "venta en curso" },
    { safe: true, reason: "ocioso" },
  ]);
  let vistoEsperando = false;
  const timer = setInterval(() => {
    try { if (status(stateDir).state === "waiting") vistoEsperando = true; } catch { /* aún no existe */ }
  }, 5);
  const r = await runGate(opts);
  clearInterval(timer);
  assert.equal(r.reason, "ocioso");
  assert.equal(vistoEsperando, true, "mientras espera, el backend puede leer que hay una actualización pendiente");
  assert.ok(calls >= 3);
});

test("'Actualizar ahora' (archivo update-now) salta la espera y se consume", async () => {
  const { stateDir, opts } = setup([{ safe: false, reason: "venta en curso" }]);
  setTimeout(() => fs.writeFileSync(path.join(stateDir, "update-now"), ""), 60);
  const r = await runGate(opts);
  assert.match(r.reason, /ahora/);
  assert.equal(fs.existsSync(path.join(stateDir, "update-now")), false);
});

test("se agota la espera máxima: se aplica aunque siga sin ser buen momento", async () => {
  const { releaseRoot, opts } = setup([{ safe: false, reason: "venta en curso" }]);
  fs.writeFileSync(path.join(releaseRoot, "update-policy.json"), JSON.stringify({ maxWaitMinutes: 0.0005 }));
  const r = await runGate(opts);
  assert.match(r.reason, /espera máxima/);
});

test("el tiempo ya esperado sobrevive a un reinicio de la compuerta (firstSeen)", async () => {
  const { stateDir, releaseRoot, opts } = setup([{ safe: false, reason: "venta en curso" }]);
  fs.writeFileSync(path.join(releaseRoot, "update-policy.json"), JSON.stringify({ maxWaitMinutes: 5 }));
  fs.writeFileSync(path.join(stateDir, "update-gate.json"),
    JSON.stringify({ version: "1.1.0", state: "waiting", firstSeen: Date.now() - 6 * 60_000, updatedAt: Date.now() }));
  const r = await runGate(opts);
  assert.match(r.reason, /espera máxima/);
});

test("sin backend en marcha (instalación nueva o parado): nada que proteger, se aplica", async () => {
  const { opts } = setup([{ safe: false, reason: "x" }]);
  const r = await runGate({ ...opts, baseUrl: "http://127.0.0.1:1" });
  assert.match(r.reason, /no hay backend/);
});

test("backend viejo sin /system/update-gate: decide la comprobación directa de la base", async () => {
  const { opts } = setup(["404"]);
  let preguntas = 0;
  const r = await runGate({
    ...opts,
    dbCheck: async () => (++preguntas < 3 ? { safe: false, reason: "caja abierta" } : { safe: true, reason: "caja cerrada" }),
  });
  assert.equal(r.reason, "caja cerrada");
  assert.equal(preguntas, 3);
});

test("la compuerta ya se pasó para esta versión hace un momento: sale al instante sin consultar", async () => {
  const { stateDir, opts } = setup([{ safe: false, reason: "no debería preguntarse" }]);
  fs.writeFileSync(path.join(stateDir, "update-gate-ok"), JSON.stringify({ version: "1.1.0", at: Date.now() }));
  const r = await runGate(opts);
  assert.match(r.reason, /ya se pasó/);
  assert.equal(calls, 0);
});

test("la marca de OTRA versión no vale", async () => {
  const { stateDir, opts } = setup([{ safe: false, reason: "venta" }, { safe: true, reason: "ocioso" }]);
  fs.writeFileSync(path.join(stateDir, "update-gate-ok"), JSON.stringify({ version: "0.9.0", at: Date.now() }));
  const r = await runGate(opts);
  assert.equal(r.reason, "ocioso");
  assert.ok(calls >= 2);
});

test("un fallo al consultar NUNCA bloquea la actualización", async () => {
  const { opts } = setup([{ safe: false, reason: "x" }]);
  // respuesta 500 simulada con un servidor aparte
  const bad = http.createServer((q, s) => { s.writeHead(500); s.end(); });
  await new Promise((r) => bad.listen(0, "127.0.0.1", r));
  const r = await runGate({ ...opts, baseUrl: `http://127.0.0.1:${bad.address().port}` });
  bad.close();
  assert.match(r.reason, /no se pudo consultar/);
});

test("la consulta directa a la base usa la tabla y columna reales del esquema de Prisma", () => {
  // Prisma mapea el modelo CashSession a otra tabla; un nombre mal puesto hace que la comprobación
  // directa falle SIEMPRE y la compuerta aplique en cualquier momento (visto en la VM el 2026-10-05).
  const src = fs.readFileSync(new URL("./update-gate.mjs", import.meta.url), "utf8");
  const schema = fs.readFileSync(new URL("../../backend/prisma/schema.prisma", import.meta.url), "utf8");
  const table = /FROM (\w+) WHERE status/.exec(src)?.[1];
  const model = /model CashSession \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";
  assert.ok(model.includes(`@@map("${table}")`), `la tabla ${table} no es la que Prisma mapea para CashSession`);
  assert.match(model, /\n\s+status\s+CashSessionStatus/);
  assert.doesNotMatch(model, /status[^\n]*@map/);
});
