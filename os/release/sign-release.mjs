#!/usr/bin/env node
// Empaqueta y FIRMA una versión de la capa de aplicación del POS.
//   node sign-release.mjs --version 1.2.0 --stage ./stage --out ./dist --url-base https://updates.ejemplo.com/pos \
//        --key ./release-private.pem
//   node sign-release.mjs --gen-keys ./keys        (crea release-private.pem y release-public.pem)
//
// --stage es la carpeta ya armada con lo que va en la versión (backend compilado con sus
// node_modules de producción, pantalla compilada, prisma/migrations…). Genera:
//   <out>/facturero-pos-<versión>.tar.gz   el paquete
//   <out>/latest.json                      manifiesto firmado que consulta el actualizador
// La clave PRIVADA no se guarda en el repositorio ni en el equipo del cliente: solo firma quien
// publica. La pública (release-public.pem) sí va en la imagen del sistema operativo.

import { createHash, generateKeyPairSync, sign, createPrivateKey } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const need = (name) => arg(name) ?? (() => { throw new Error(`Falta --${name}`); })();

if (process.argv.includes("--gen-keys")) {
  const dir = arg("gen-keys");
  fs.mkdirSync(dir, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  fs.writeFileSync(path.join(dir, "release-private.pem"), privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, "release-public.pem"), publicKey.export({ type: "spki", format: "pem" }));
  console.log(`Claves creadas en ${dir}. Guarda release-private.pem FUERA del repo.`);
  process.exit(0);
}

const version = need("version");
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("--version debe ser X.Y.Z");
const stage = path.resolve(need("stage"));
const out = path.resolve(need("out"));
const urlBase = need("url-base").replace(/\/$/, "");
const privateKey = createPrivateKey(fs.readFileSync(need("key"), "utf8"));

fs.mkdirSync(out, { recursive: true });
const name = `facturero-pos-${version}.tar.gz`;
fs.writeFileSync(path.join(stage, "VERSION"), version + "\n");
// tar se ejecuta con cwd = stage y escribe el paquete en el directorio HERMANO ("../<nombre>"): una
// ruta relativa corta funciona igual con GNU tar de Git Bash (que ve /tmp y C:\Users con raices
// distintas: un "../../../.." largo hasta --out apuntaba fuera del arbol) y con bsdtar de Windows. Luego
// se mueve a --out con fs.
const sibling = path.join(path.dirname(stage), `.${name}.${process.pid}`);
const r = spawnSync("tar", ["-czf", `../${path.basename(sibling)}`, "."], { cwd: stage, stdio: "inherit" });
if (r.status !== 0) throw new Error("tar falló");
fs.copyFileSync(sibling, path.join(out, name));
fs.rmSync(sibling, { force: true });

const bytes = fs.readFileSync(path.join(out, name));
const payload = Buffer.from(JSON.stringify({
  version,
  url: `${urlBase}/${name}`,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  size: bytes.length,
  notes: arg("notes") ?? "",
  publishedAt: new Date().toISOString(),
}));
const manifest = { payload: payload.toString("base64"), signature: sign(null, payload, privateKey).toString("base64") };
fs.writeFileSync(path.join(out, "latest.json"), JSON.stringify(manifest, null, 2));
console.log(`OK: ${name} (${bytes.length} bytes) + latest.json`);
