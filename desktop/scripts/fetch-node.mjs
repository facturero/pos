// Baja el runtime de Node que va DENTRO del .exe y lo deja en vendor/node/.
//
// Por qué un Node propio y no el que trae Electron (ELECTRON_RUN_AS_NODE): el backend importa
// argon2 (dist/routes/auth.routes.js), un addon nativo, y con el Node embebido de Electron (20.18)
// el proceso MUERE al cargarlo — sin error, sin log — y main.js lo relanza cada 2 s para siempre.
// Comprobado: con Node 22.14.0 el mismo argon2 hashea y verifica sin problema. Es el mismo runtime
// que ya usa el kiosco (os/provision/install.sh baja Node 22.14.0 al /opt/facturero/runtime/):
// aquí se replica ese patrón en vez de inventar un tercero.
//
// El SHA256 se verifica contra SHASUMS256.txt de nodejs.org, igual que install.sh:104-113. La clave
// no viaja en el repo pero esto tampoco es secreto: es el runtime público de Node.
//
// OJO con la plataforma: NO se baja siempre la de Windows. Esta carpeta se centró primero en Windows
// y luego se traspasó a Linux/Mint, así que el nombre del archivo y el ejecutable cambian según dónde
// se corra. Con "win-x64" fijo, en Linux se bajaba un node.exe que no arranca.
//
//   node scripts/fetch-node.mjs [--force]

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = path.join(ROOT, "vendor", "node");

// Fijado, no "latest": el .exe tiene que ser reproducible y el addon nativo de argon2 se compila o
// descarga contra una versión concreta. Cambiarlo es una decisión consciente, no un efecto colateral.
const VERSION = "22.14.0";

// Los tres datos que cambian por plataforma, y que OJO usan nombres distintos entre sí:
//   1. el token del archivo  (nodejs.org: "win-x64", no el "win32-x64" de npm — con el otro, 404)
//   2. la extensión          (windows .zip, linux .tar.xz, mac .tar.gz)
//   3. el nombre del binario (node.exe en windows, node en el resto)
function platformInfo() {
  const arch = process.arch;
  const p = process.platform;
  if (p === "win32") {
    const token = arch === "arm64" ? "win-arm64" : "win-x64";
    return { token, ext: "zip", bin: "node.exe" };
  }
  if (p === "linux") {
    const token =
      arch === "arm64" ? "linux-arm64" : arch === "arm" ? "linux-armv7l" : `linux-${arch}`;
    return { token, ext: "tar.xz", bin: "node" };
  }
  if (p === "darwin") {
    const token = arch === "arm64" ? "darwin-arm64" : "darwin-x64";
    return { token, ext: "tar.gz", bin: "node" };
  }
  throw new Error(`plataforma sin runtime de Node conocido: ${p}/${arch}`);
}

const { token, ext, bin } = platformInfo();
const TARBALL = `node-v${VERSION}-${token}.${ext}`;
const BASE = `https://nodejs.org/dist/v${VERSION}`;

const force = process.argv.includes("--force");
const log = (m) => console.log(`[fetch-node] ${m}`);

function alreadyThere() {
  const exe = path.join(VENDOR, bin);
  const stamp = path.join(VENDOR, "VERSION");
  return fs.existsSync(exe) && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8").trim() === VERSION;
}

if (alreadyThere() && !force) {
  log(`Node ${VERSION} ya está en ${path.relative(ROOT, VENDOR)} (usa --force para rehacerlo)`);
  process.exit(0);
}

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// La línea EXACTA del tarball se saca comparando el SEGUNDO campo: un grep con el "$" final no
// entiende el fin de línea y devolvía nada (mismo fallo que ya corrigió install.sh:111).
function checksumLineFor(sums, file) {
  const line = sums
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .find((l) => l.split(/\s+/)[1] === file);
  if (!line) throw new Error(`SHASUMS256.txt no trae ${file}`);
  return line.split(/\s+/)[0];
}

// tar primero (el bsdtar que trae Windows 10+ y el GNU tar de Linux auto-detectan el formato), y el
// flag explícito de xz/gz como segundo intento por si el tar de la máquina no autodetecta.
function extract(archive, dest, flags) {
  fs.mkdirSync(dest, { recursive: true });
  const attempts = [["tar", ["-xf", archive, "-C", dest]], ["tar", flags(archive, dest)]];
  for (const [cmd, args] of attempts) {
    const r = spawnSync(cmd, args, { stdio: "inherit" });
    if (!r.error && r.status === 0) return;
  }
  // En Windows el zip de nodejs.org también se abre con Expand-Archive.
  const viaPs = spawnSync(
    "powershell",
    ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${dest}' -Force`],
    { stdio: "inherit" }
  );
  if (viaPs.error || viaPs.status !== 0) throw new Error(`no se pudo descomprimir ${path.basename(archive)}`);
}

log(`bajando Node ${VERSION} (${token}, ${process.platform}/${process.arch})…`);
const [archive, sumsBytes] = await Promise.all([
  download(`${BASE}/${TARBALL}`),
  download(`${BASE}/SHASUMS256.txt`),
]);

const expected = checksumLineFor(sumsBytes.toString("utf8"), TARBALL);
const got = createHash("sha256").update(archive).digest("hex");
if (got !== expected) throw new Error(`sha256 del runtime no coincide con SHASUMS256.txt\n  esperado ${expected}\n  obtenido ${got}`);
log("sha256 verificado contra SHASUMS256.txt");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pos-node-"));
const archivePath = path.join(tmp, TARBALL);
fs.writeFileSync(archivePath, archive);

// El archivo trae node-v<version>-<token>/: se aplana a vendor/node/ (lo que espera electron-builder
// como extraResource y lo que main.js busca; sin aplanar, el binario queda un nivel más abajo).
fs.rmSync(VENDOR, { recursive: true, force: true });
const flags = ext === "tar.xz" ? (a, d) => ["-xJf", a, "-C", d] : (a, d) => ["-xzf", a, "-C", d];
extract(archivePath, VENDOR, flags);
const extracted = path.join(VENDOR, `node-v${VERSION}-${token}`);
if (fs.existsSync(extracted)) {
  for (const entry of fs.readdirSync(extracted)) {
    fs.renameSync(path.join(extracted, entry), path.join(VENDOR, entry));
  }
  fs.rmSync(extracted, { recursive: true, force: true });
}
fs.writeFileSync(path.join(VENDOR, "VERSION"), VERSION + "\n");
fs.rmSync(tmp, { recursive: true, force: true });

const exe = path.join(VENDOR, bin);
if (!fs.existsSync(exe)) throw new Error(`la extracción no dejó ${exe}`);
log(`listo: ${path.relative(ROOT, exe)}`);