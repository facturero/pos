#!/usr/bin/env node
// Punto de entrada del actualizador (lo llama un timer de systemd).
//   node cli.mjs [/etc/facturero/updater.json]
// El JSON lleva la misma config que update() en updater.mjs; `publicKeyFile` apunta al PEM.
import fs from "node:fs";
import { update, EXIT } from "./updater.mjs";

const file = process.argv[2] ?? "/etc/facturero/updater.json";
const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
cfg.publicKey = cfg.publicKey ?? fs.readFileSync(cfg.publicKeyFile, "utf8");

try {
  const r = await update(cfg);
  process.exit(r.code);
} catch (err) {
  console.error(`[updater] ERROR: ${err.message}`);
  process.exit(EXIT.ERROR);
}
