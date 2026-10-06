// Arma el backend tal y como va dentro del .exe: dist compilado + prisma + node_modules SOLO de
// producción, en stage/backend/. electron-builder copia esa carpeta como extraResource.
//
// Por qué un stage y no apuntar directamente a ../backend: extraResources copia el árbol entero de
// ../backend/node_modules, que en la máquina de desarrollo trae typescript, tsx y los @types — unos
// 100 MB de-basura en cada instalador. build-release.sh ya hace lo mismo para el kiosco (npm ci
// --omit=dev dentro del contenedor, línea 98 de os/release/build-release.sh).
//
//   node scripts/stage-backend.mjs [--skip-build]
//
// --skip-build reutiliza el dist que ya haya (útil mientras se developea).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND = path.join(ROOT, "..", "backend");
const STAGE = path.join(ROOT, "stage", "backend");

const skipBuild = process.argv.includes("--skip-build");
const log = (m) => console.log(`[stage-backend] ${m}`);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

function npm(args, cwd) {
  const exe = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(exe, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`npm ${args.join(" ")} terminó con código ${r.status}`);
}

if (!skipBuild) {
  log("compilando el backend (tsc)…");
  npm(["run", "build"], BACKEND);
}

if (!fs.existsSync(path.join(BACKEND, "dist", "index.js"))) {
  throw new Error("no hay dist/index.js: compila el backend antes (npm run build en pos/backend)");
}

log(`armando ${path.relative(ROOT, STAGE)}`);
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

// package.json y package-lock.json primero: npm ci los necesita para resolver, y el allowScripts
// del backend es lo que autoriza a argon2/prisma a ejecutar sus scripts de instalación.
for (const f of ["package.json", "package-lock.json"]) {
  fs.copyFileSync(path.join(BACKEND, f), path.join(STAGE, f));
}
copyDir(path.join(BACKEND, "prisma"), path.join(STAGE, "prisma"));
copyDir(path.join(BACKEND, "dist"), path.join(STAGE, "dist"));
// El backend lee su versión de dist/VERSION (en el kiosco la escribe build-release.sh). Sin este archivo la barra
// inferior y /system/info dirían "sin versión". Es la de este paquete: desktop/package.json.
fs.writeFileSync(
  path.join(STAGE, "dist", "VERSION"),
  `${JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version}
`
);

log("npm ci --omit=dev (puede tardar: baja argon2 y los motores de Prisma para Windows)…");
npm(["ci", "--omit=dev", "--no-audit", "--no-fund"], STAGE);

// prisma generate explícito: el .exe corre `migrate deploy` en la máquina del cliente, y el cliente
// generado tiene que estar para ESA plataforma. Es el mismo orden que build-release.sh (líneas 95-98).
log("prisma generate…");
npm(["exec", "--no", "--", "prisma", "generate"], STAGE);

// tamaño de un árbol, para contabilizar lo que se poda antes de borrarlo
function walkSize(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? walkSize(p) : fs.statSync(p).size || 0;
  }
  return total;
}

// Prisma publica los motores de TODAS las plataformas en el mismo paquete, y el de la plataforma
// actual aparece repetido en tres rutas (@prisma/engines, prisma/ y .prisma/client). Se cuelan ~50 MB
// de motores y prebuilds de los otros sistemas operativos, que el cliente no puede ejecutar nunca.
// Prisma elige el motor por plataforma en runtime, así que podar por nombre no cambia el
// comportamiento, solo el instalador.
//
// LA PODA ES INVERTIDA RESPECTO A LA PLATAFORMA, no una lista fija de "los otros": esta carpeta se
// traspasó de Windows a Linux/Mint, y con una lista fija que quitara debian/linux, en Linux se
// borraba justo el motor que hace falta y el stage quedaba inservible sin ningún error visible.
const OWN_ENGINE_TAGS = { win32: ["windows"], linux: ["debian", "linux"], darwin: ["darwin"] }[process.platform];
if (!OWN_ENGINE_TAGS) throw new Error(`plataforma no soportada para el stage: ${process.platform}`);
// OJO: Prisma no llama "linux" a su motor glibc, lo llama "debian" (libquery_engine-debian-openssl-3.0.x);
// "linux" es el de musl. Faltando "debian" en esta lista, en Windows sobrevivían los .so de Linux.
const ALL_ENGINE_TAGS = ["windows", "debian", "linux", "darwin"];
const otherTags = ALL_ENGINE_TAGS.filter((t) => !OWN_ENGINE_TAGS.includes(t));
const foreign = new RegExp(otherTags.join("|"), "i");
// Solo se tocan ficheros que son motores de Prisma o prebuilds de argon2; cualquier otro paquete
// puede llevar "linux" en el nombre sin ser un motor.
// OJO al separador: Prisma mezcla estilos, "schema-engine-..." con guion pero "libquery_engine-..."
// con guion bajo. Con un solo estilo se colaban los ficheros más grandes, que son los libquery.
const isPrunable = (name) =>
  /(^|[\\/])(lib)?(query|schema|migration|introspection)[-_]engine-/i.test(name) || /prisma-fmt/i.test(name);

// argon2 nomera sus prebuilds como <platform>-<arch> (win32-x64, linux-x64, darwin-arm64...)
const OWN_PREBUILD = `${process.platform}-${process.arch}`;

function pruneForeignPlatforms(dir, stats) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      // Un directorio de otra plataforma se va entero: dentro, los ficheros ya no llevan el nombre
      // de la plataforma (el motor es .cache/prisma/<hash>/debian-openssl-3.0.x/libquery-engine).
      if (foreign.test(e.name)) {
        stats.bytes += walkSize(p);
        fs.rmSync(p, { recursive: true, force: true });
        stats.pruned++;
        continue;
      }
      // argon2 trae un prebuild por plataforma: aquí solo puede servirse el de esta máquina.
      if (e.name === "prebuilds" && path.basename(dir) === "argon2") {
        for (const pf of fs.readdirSync(p)) {
          if (pf !== OWN_PREBUILD) {
            stats.bytes += walkSize(path.join(p, pf));
            fs.rmSync(path.join(p, pf), { recursive: true, force: true });
            stats.pruned++;
          }
        }
        continue;
      }
      pruneForeignPlatforms(p, stats);
    } else if (foreign.test(e.name) && isPrunable(p)) {
      // el tamaño se mide ANTES de borrar: después el stat lanza
      stats.bytes += fs.statSync(p).size || 0;
      fs.rmSync(p, { force: true });
      stats.pruned++;
    }
  }
}

log(`podando motores y prebuilds ajenos a ${process.platform} (${otherTags.join(", ")})…`);
const pruneStats = { pruned: 0, bytes: 0 };
pruneForeignPlatforms(path.join(STAGE, "node_modules"), pruneStats);
log(`   ${pruneStats.pruned} ficheros de otros sistemas fuera: ${(pruneStats.bytes / 1024 / 1024).toFixed(1)} MB`);

// Sin esto, un stage con las migraciones a medias daría un error críptico en el cliente.
const checks = [
  ["CLI de prisma (la usa migrate deploy)", path.join(STAGE, "node_modules", "prisma", "build", "index.js")],
  [`addon nativo argon2 (${OWN_PREBUILD})`, path.join(STAGE, "node_modules", "argon2", "prebuilds", OWN_PREBUILD)],
  ["cliente de prisma generado", path.join(STAGE, "node_modules", ".prisma", "client")],
];
const missing = checks.filter(([, p]) => !fs.existsSync(p)).map(([label]) => label);
if (missing.length) throw new Error(`el stage está incompleto: falta ${missing.join(", ")}`);

let bytes = 0;
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else bytes += fs.statSync(p).size;
  }
};
walk(STAGE);
log(`listo: ${(bytes / 1024 / 1024).toFixed(1)} MB, ${checks.length} comprobaciones OK`);
