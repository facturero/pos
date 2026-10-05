#!/usr/bin/env node
// "Compuerta" de actualización: espera a que sea un buen momento para aplicar una versión ya descargada,
// como hace Discord (baja en segundo plano y aplica sin pillarte a media faena). Sale con 0 cuando se
// puede aplicar; mientras espera, la versión vieja sigue sirviendo con normalidad.
//
// Quién lo llama (cualquiera de los dos; la segunda llamada sale al instante por la marca):
//   - el actualizador nuevo, como `gateCmd`, justo antes de parar el backend (os/updater/updater.mjs)
//   - node_modules/.bin/prisma (os/release/prisma-wrapper.sh) antes de `migrate deploy`: así lo
//     ejecuta TAMBIÉN el actualizador viejo de las cajas ya instaladas, que no puede cambiar sin ISO.
//
// Cuándo es seguro (lo decide el backend en ejecución, GET /system/update-gate, que ve la caja y los
// latidos de la pantalla): caja cerrada, o carrito vacío y sin tocar nada durante unos minutos, o no hay
// pantalla conectada. Se aplica igualmente si:
//   - el usuario pulsó "Actualizar ahora" (archivo update-now)
//   - pasó el tiempo máximo de espera (por defecto 3 días; update-policy.json de la release puede bajarlo,
//     p. ej. `build-release.sh --urgent` lo deja en 15 min)
// Si el backend en marcha es de una versión anterior que no tiene /system/update-gate (el primer salto
// desde <= 0.3.4), se mira la base de datos directamente: caja abierta = no es momento.
//
// Regla de oro: esta compuerta NUNCA debe impedir una actualización por un fallo suyo. Cualquier error
// interno se registra y se sale con 0 (se aplica).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DAY_MS = 24 * 60 * 60 * 1000;

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export async function runGate(opts = {}) {
  const stateDir = opts.stateDir ?? env("UPDATE_STATE_DIR", "/var/lib/facturero");
  const baseUrl = opts.baseUrl ?? env("UPDATE_GATE_BASE_URL", "http://127.0.0.1:4000");
  const pollMs = opts.pollMs ?? Number(env("UPDATE_GATE_POLL_MS", 10_000));
  const version = opts.version ?? env("RELEASE_VERSION", "desconocida");
  const log = opts.log ?? ((m) => console.log(`[update-gate] ${m}`));
  const releaseRoot = opts.releaseRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dbCheck = opts.dbCheck ?? defaultDbCheck;

  const statusFile = path.join(stateDir, "update-gate.json");
  const nowFlag = path.join(stateDir, "update-now");
  const passedFile = path.join(stateDir, "update-gate-ok");

  let maxWaitMs = Number(env("UPDATE_GATE_MAX_WAIT_MINUTES", 0)) * 60_000 || 3 * DAY_MS;
  try {
    const policy = JSON.parse(fs.readFileSync(path.join(releaseRoot, "update-policy.json"), "utf8"));
    if (Number(policy.maxWaitMinutes) > 0) maxWaitMs = Number(policy.maxWaitMinutes) * 60_000;
  } catch {
    // sin política: se queda el valor por defecto
  }

  try {
    fs.mkdirSync(stateDir, { recursive: true });
  } catch {
    // sin directorio de estado no se puede esperar de forma visible: se aplica
    log(`no se pudo usar ${stateDir}; se aplica sin esperar`);
    return { applied: true, reason: "sin directorio de estado" };
  }

  const readJson = (f) => {
    try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
  };
  const writeStatus = (s) => {
    try { fs.writeFileSync(statusFile, JSON.stringify({ ...s, updatedAt: Date.now() })); } catch { /* informativo */ }
  };
  const pass = (reason) => {
    try { fs.writeFileSync(passedFile, JSON.stringify({ version, at: Date.now() })); } catch { /* informativo */ }
    writeStatus({ version, state: "applying", reason });
    try { fs.rmSync(nowFlag, { force: true }); } catch { /* ya no existe */ }
    log(`se aplica ${version}: ${reason}`);
    return { applied: true, reason };
  };

  // Ya se pasó la compuerta hace un momento para esta versión (la llama dos veces el actualizador nuevo:
  // gateCmd y el wrapper de prisma): no se vuelve a esperar.
  const marker = readJson(passedFile);
  if (marker && marker.version === version && Date.now() - marker.at < 10 * 60_000) {
    return { applied: true, reason: "la compuerta ya se pasó" };
  }

  const prev = readJson(statusFile);
  const firstSeen = prev && prev.version === version && prev.firstSeen ? prev.firstSeen : Date.now();

  for (;;) {
    if (fs.existsSync(nowFlag)) return pass("el usuario pidió actualizar ahora");
    if (Date.now() - firstSeen >= maxWaitMs) return pass("se agotó la espera máxima");

    let verdict;
    try {
      verdict = await askBackend(baseUrl);
      if (verdict === "sin-endpoint") verdict = await dbCheck();
    } catch (err) {
      log(`no pude consultar el estado (${err.message}); se aplica`);
      return pass("no se pudo consultar el estado");
    }
    if (verdict.safe) return pass(verdict.reason);

    writeStatus({ version, state: "waiting", firstSeen, reason: verdict.reason });
    log(`esperando un buen momento para ${version}: ${verdict.reason}`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

// El backend nuevo contesta {safe, reason}. Sin backend (instalación nueva o parado): nada que proteger.
async function askBackend(baseUrl) {
  let res;
  try {
    res = await fetch(`${baseUrl}/system/update-gate`, { signal: AbortSignal.timeout(4000) });
  } catch {
    return { safe: true, reason: "no hay backend en marcha" };
  }
  if (res.status === 404) return "sin-endpoint";
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return { safe: Boolean(body.safe), reason: String(body.reason ?? "") };
}

// Versiones <= 0.3.4 no tienen /system/update-gate: se mira la base directamente. Solo se sabe si hay
// caja abierta; carrito y actividad no están en la base. Cualquier fallo = "no sé" = se aplica.
async function defaultDbCheck() {
  try {
    const url = process.env.DATABASE_URL ?? "";
    const file = decodeURIComponent(url.replace(/^file:/, "").split("?")[0]);
    if (!file) return { safe: true, reason: "sin DATABASE_URL" };
    const { DatabaseSync } = await import("node:" + "sqlite");
    const db = new DatabaseSync(file, { readOnly: true });
    const row = db.prepare("SELECT COUNT(*) AS n FROM cash_sessions WHERE status = 'OPEN'").get();
    db.close();
    return row.n > 0
      ? { safe: false, reason: "hay una caja abierta (se aplica al cerrarla)" }
      : { safe: true, reason: "caja cerrada" };
  } catch (err) {
    return { safe: true, reason: `no pude leer la base (${err.message})` };
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runGate().then(
    () => process.exit(0),
    (err) => {
      console.error(`[update-gate] error inesperado (${err?.message}); se aplica`);
      process.exit(0);
    },
  );
}
