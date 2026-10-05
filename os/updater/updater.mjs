// Actualizador de la capa de aplicación del POS ("tipo Discord": el sistema operativo casi
// no cambia, la app se actualiza sola). Sin dependencias: solo Node.
//
// Layout en disco (root = /opt/facturero):
//   releases/<versión>/   cada versión completa (backend + pantalla + migraciones)
//   current -> releases/<versión>   lo que está corriendo (enlace que se cambia de golpe)
//   state.json            versión anterior y versiones que fallaron (no se reintentan)
//
// Flujo: manifiesto firmado -> descarga -> sha256 -> descomprime -> migraciones -> cambia
// `current` -> reinicia -> comprueba salud; si no responde, vuelve a la versión anterior.
//
// Regla para las migraciones de la base de datos: solo avanzan (no hay marcha atrás), así que
// deben ser compatibles hacia atrás (agregar columnas/tablas, no borrar ni renombrar en la misma
// versión); si no, la versión anterior no podría volver a arrancar tras un rollback.

import { createHash, verify, createPublicKey } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const EXIT = { OK: 0, ERROR: 1, ROLLED_BACK: 2, LOCKED: 3 };

// --- versiones -------------------------------------------------------------

export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  if (pa.concat(pb).some((n) => !Number.isInteger(n) || n < 0)) throw new Error(`versión inválida: ${a} / ${b}`);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// --- manifiesto firmado ----------------------------------------------------
// { payload: base64(JSON), signature: base64 }  — la firma es Ed25519 sobre los BYTES del payload
// tal como viajan, así que no hay problema de "canonicalización" del JSON.

export function verifyManifest(manifest, publicKeyPem) {
  if (!manifest?.payload || !manifest?.signature) throw new Error("manifiesto sin payload o firma");
  const bytes = Buffer.from(manifest.payload, "base64");
  const ok = verify(null, bytes, createPublicKey(publicKeyPem), Buffer.from(manifest.signature, "base64"));
  if (!ok) throw new Error("la firma del manifiesto NO es válida");
  const p = JSON.parse(bytes.toString("utf8"));
  for (const k of ["version", "url", "sha256", "size"]) if (p[k] === undefined) throw new Error(`manifiesto sin ${k}`);
  return p;
}

// --- utilidades ------------------------------------------------------------

function run(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, { shell: true, stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`"${cmd}" terminó con código ${code}`))));
  });
}

function tar(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`tar ${args.join(" ")} → ${code}`))));
  });
}

const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
};

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// `current` es un enlace simbólico (en Windows, una "junction": no exige administrador).
function currentVersion(root) {
  try { return path.basename(fs.readlinkSync(path.join(root, "current"))); } catch { return null; }
}

function switchCurrent(root, version) {
  const link = path.join(root, "current");
  const target = path.join(root, "releases", version);
  const tmp = `${link}.new`;
  fs.rmSync(tmp, { force: true, recursive: true });
  fs.symlinkSync(target, tmp, "junction");
  // En Linux, rename sobre el enlace existente es atómico; en Windows hay que quitarlo antes.
  if (process.platform === "win32") fs.rmSync(link, { force: true, recursive: true });
  fs.renameSync(tmp, link);
}

async function download(url, dest, expectedSize, sha256) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!res.ok) throw new Error(`descarga ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length !== expectedSize) throw new Error(`tamaño ${bytes.length} ≠ ${expectedSize} del manifiesto`);
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== sha256) throw new Error("sha256 del paquete no coincide con el manifiesto");
  fs.writeFileSync(dest, bytes);
}

async function healthy(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return true;
    } catch { /* aún no responde */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function prune(root, keep, protect) {
  const dir = path.join(root, "releases");
  const versions = fs.readdirSync(dir).filter((v) => !v.endsWith(".partial")).sort(compareVersions);
  const removable = versions.filter((v) => !protect.includes(v));
  for (const v of removable.slice(0, Math.max(0, removable.length - Math.max(0, keep - protect.length)))) {
    fs.rmSync(path.join(dir, v), { recursive: true, force: true });
  }
}

// --- flujo principal -------------------------------------------------------

/**
 * config: { root, manifestUrl, publicKey (PEM), gateCmd?, stopCmd?, migrateCmd?, restartCmd?, healthUrl?,
 *           healthTimeoutMs?=60000, keepReleases?=3, migrateRetries?=0, migrateRetryDelayMs?=3000, log? }
 * Los comandos se ejecutan con cwd = la versión nueva y RELEASE_DIR / RELEASE_VERSION en el entorno
 * (stopCmd, y el restartCmd de recuperación, con los de la versión que estaba corriendo).
 *
 * gateCmd (opcional): comando que BLOQUEA hasta que sea buen momento para aplicar (ver
 * os/release/update-gate.mjs, que viaja dentro de la release). Va antes de stopCmd y solo si ya hay
 * una versión corriendo; si falla, se aplica igualmente.
 *
 * stopCmd (opcional): para la versión en curso justo antes de migrar; restartCmd la vuelve a
 * levantar (con la nueva, o con la anterior si la migración falla). Causa raíz verificada el
 * 2026-10-04: con la base en modo WAL, el schema-engine de Prisma necesita acceso exclusivo, así que
 * `prisma migrate deploy` falla SIEMPRE con "database is locked" mientras el backend esté vivo. Desde
 * la 0.3.5 el backend usa journal DELETE y el paquete trae un wrapper de `prisma` que resuelve el
 * primer salto, por lo que las cajas con un actualizador viejo ya NO dependen de esto; stopCmd queda
 * como cinturón y tirantes para instalaciones nuevas. Costo: unos segundos sin servicio al actualizar.
 *
 * migrateRetries (por defecto 0, no cambia el comportamiento de siempre): reintentos de la
 * migración antes de darla por mala. Se agregó el 2026-09-29 creyendo que el "database is locked"
 * era un choque momentáneo; resultó NO serlo (ver stopCmd), así que NO arregla ese caso — solo
 * sirve para fallos de verdad transitorios. Una versión que "falla" aquí queda en `state.bad` para
 * siempre. Los reintentos SON seguros: `prisma migrate deploy` está pensado para poder correr
 * varias veces sobre el mismo estado.
 */
export async function update(config) {
  const log = config.log ?? ((m) => console.log(`[updater] ${m}`));
  const { root } = config;
  fs.mkdirSync(path.join(root, "releases"), { recursive: true });
  fs.mkdirSync(path.join(root, "downloads"), { recursive: true });

  const lock = path.join(root, "updater.lock");
  let fd;
  try { fd = fs.openSync(lock, "wx"); } catch { log("otra actualización está en curso"); return { code: EXIT.LOCKED }; }

  try {
    const stateFile = path.join(root, "state.json");
    const state = readJson(stateFile, { previous: null, bad: [] });
    const current = currentVersion(root);

    const res = await fetch(config.manifestUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`manifiesto ${res.status}`);
    const m = verifyManifest(await res.json(), config.publicKey);

    if (current && compareVersions(m.version, current) <= 0) { log(`al día (${current})`); return { code: EXIT.OK, updated: false }; }
    if (state.bad.includes(m.version)) { log(`la versión ${m.version} ya falló aquí; no se reintenta`); return { code: EXIT.OK, updated: false }; }

    const releaseDir = path.join(root, "releases", m.version);
    const partial = `${releaseDir}.partial`;
    const pkg = path.join(root, "downloads", `${m.version}.tar.gz`);
    log(`nueva versión ${m.version} (actual: ${current ?? "ninguna"})`);

    await download(m.url, pkg, m.size, m.sha256);
    fs.rmSync(partial, { recursive: true, force: true });
    fs.rmSync(releaseDir, { recursive: true, force: true });
    fs.mkdirSync(partial, { recursive: true });
    await tar(["-xzf", path.relative(partial, pkg).split(path.sep).join("/")], partial);
    fs.renameSync(partial, releaseDir);

    const env = { ...process.env, RELEASE_DIR: releaseDir, RELEASE_VERSION: m.version };
    const currentEnv = { ...process.env, RELEASE_DIR: path.join(root, "releases", String(current)), RELEASE_VERSION: String(current) };

    // Compuerta: con la versión nueva ya descargada y descomprimida, se espera a un buen momento (caja
    // cerrada / pantalla ociosa) antes de tocar nada, para no pillar a nadie a media venta. La versión
    // vieja sigue sirviendo mientras tanto. Es un extra: si falla, se aplica igualmente (que la compuerta
    // se rompa no debe dejar la caja sin poder actualizarse). Solo si ya había algo corriendo.
    if (config.gateCmd && current) {
      log("esperando un buen momento para aplicar…");
      try {
        await run(config.gateCmd, { cwd: releaseDir, env });
      } catch (err) {
        log(`la compuerta falló (${err.message}); se aplica igualmente`);
      }
    }

    // Se para la versión que está corriendo ANTES de migrar (solo si ya había una: en la
    // instalación inicial no hay nada corriendo que parar). Si el parado falla no sabemos en qué
    // estado quedó el servicio: se aborta SIN marcar la versión como mala (no es culpa de ella) y
    // se intenta dejarlo levantado.
    let stopped = false;
    if (config.stopCmd && current) {
      log("parando la versión en curso para migrar…");
      try {
        await run(config.stopCmd, { cwd: releaseDir, env: currentEnv });
        stopped = true;
      } catch (err) {
        fs.rmSync(releaseDir, { recursive: true, force: true });
        if (config.restartCmd) await run(config.restartCmd, { env: currentEnv }).catch(() => {});
        throw new Error(`no se pudo parar la versión ${current}; se queda como está: ${err.message}`);
      }
    }

    try {
      if (config.migrateCmd) {
        log("migraciones…");
        const retries = config.migrateRetries ?? 0;
        const delayMs = config.migrateRetryDelayMs ?? 3000;
        for (let attempt = 0; ; attempt++) {
          try {
            await run(config.migrateCmd, { cwd: releaseDir, env });
            break;
          } catch (err) {
            if (attempt >= retries) throw err;
            log(`migración falló (intento ${attempt + 1}/${retries + 1}): ${err.message} — reintentando en ${delayMs}ms`);
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }
      }
    } catch (err) {
      fs.rmSync(releaseDir, { recursive: true, force: true });
      state.bad.push(m.version);
      writeJsonAtomic(stateFile, state);
      // La versión anterior quedó parada para migrar: hay que devolverla al aire, o la caja se
      // queda sin servicio por un fallo que ni siquiera tocó su código.
      if (stopped && config.restartCmd) await run(config.restartCmd, { env: currentEnv }).catch(() => {});
      throw new Error(`falló la migración; se queda la versión ${current}: ${err.message}`);
    }

    switchCurrent(root, m.version);
    try {
      if (config.restartCmd) await run(config.restartCmd, { cwd: releaseDir, env });
      if (config.healthUrl && !(await healthy(config.healthUrl, config.healthTimeoutMs ?? 60_000))) {
        throw new Error("la nueva versión no respondió a tiempo");
      }
    } catch (err) {
      log(`FALLÓ ${m.version} (${err.message}); volviendo a ${current}`);
      state.bad.push(m.version);
      if (current) {
        switchCurrent(root, current);
        if (config.restartCmd) await run(config.restartCmd, { env: { ...process.env, RELEASE_DIR: path.join(root, "releases", current), RELEASE_VERSION: current } }).catch(() => {});
      }
      writeJsonAtomic(stateFile, state);
      return { code: EXIT.ROLLED_BACK, version: m.version, rolledBackTo: current };
    }

    state.previous = current;
    writeJsonAtomic(stateFile, state);
    fs.rmSync(pkg, { force: true });
    prune(root, config.keepReleases ?? 3, [m.version, current].filter(Boolean));
    log(`listo: ${m.version}`);
    return { code: EXIT.OK, updated: true, version: m.version, previous: current };
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
}
