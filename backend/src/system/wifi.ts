import { execFile } from "node:child_process";

// Wi-Fi desde la barra de estado del POS: listar redes visibles y conectar a una. Usa `nmcli`
// (NetworkManager) — Ubuntu Server por defecto usa netplan+systemd-networkd, que no tiene "escanear y
// conectar" interactivo, así que el instalador (os/provision/install.sh) instala network-manager y le
// entrega la gestión de las interfaces (netplan con renderer: NetworkManager). Sin sudo a propósito: la
// regla de polkit del instalador (os/provision/polkit-network.rules) le da a `facturero` permiso para
// manejar su propia red; pasar la contraseña por sudo la dejaría visible en `ps` más tiempo del necesario.
//
// SIN PROBAR CON UNA TARJETA WI-FI REAL: VirtualBox no simula una. El parser de la salida `-t` de nmcli
// tiene pruebas (wifi.test.ts) con líneas de ejemplo, pero el escaneo/conexión de verdad solo se puede
// verificar en hardware.

export interface WifiNetwork {
  ssid: string;
  signal: number; // 0-100
  secured: boolean;
  active: boolean; // ya conectado a esta red
}

interface Exec {
  run(args: string[]): Promise<{ stdout: string; stderr: string; code: number }>;
}

const realExec: Exec = {
  run: (args) =>
    new Promise((resolve) => {
      execFile("nmcli", args, { timeout: 20_000 }, (err, stdout, stderr) => {
        resolve({ stdout, stderr, code: (err as NodeJS.ErrnoException & { code?: number })?.code ?? 0 });
      });
    }),
};

// La salida `-t` (terse) de nmcli separa campos con ":" y escapa los ":" y "\" literales del VALOR como
// "\:" y "\\". Un split simple por ":" rompería un SSID que contenga ":". `split-terse` deshace eso.
export function splitTerseLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && i + 1 < line.length) {
      current += line[i + 1];
      i++;
    } else if (ch === ":") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

export function parseWifiList(stdout: string): WifiNetwork[] {
  const bySsid = new Map<string, WifiNetwork>();
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const [inUse, ssid, signalRaw, security] = splitTerseLine(line);
    if (!ssid) continue; // red oculta (SSID vacío): no se puede conectar sin saber el nombre
    const signal = Number(signalRaw) || 0;
    const existing = bySsid.get(ssid);
    if (existing && existing.signal >= signal) continue; // se queda con la señal más fuerte
    bySsid.set(ssid, { ssid, signal, secured: security.trim() !== "" && security.trim() !== "--", active: inUse.trim() === "*" });
  }
  return [...bySsid.values()].sort((a, b) => b.signal - a.signal);
}

export async function listNetworks(exec: Exec = realExec): Promise<WifiNetwork[]> {
  const { stdout, stderr, code } = await exec.run(["-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list", "--rescan", "yes"]);
  if (code !== 0) throw new Error(stderr.trim() || "No se pudo escanear redes Wi-Fi (¿el equipo tiene tarjeta Wi-Fi?)");
  return parseWifiList(stdout);
}

// Traduce los errores más comunes de nmcli a algo que un cajero entienda; el resto se muestra tal cual
// (mejor un mensaje técnico visible que uno inventado que oculte la causa real).
function translateConnectError(stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes("secrets were required") || s.includes("802-11-wireless-security")) return "Contraseña incorrecta";
  if (s.includes("no network with ssid")) return "No se encuentra esa red (¿sigue al alcance?)";
  return stderr.trim() || "No se pudo conectar";
}

export async function connect(ssid: string, password: string | undefined, exec: Exec = realExec): Promise<void> {
  const args = ["device", "wifi", "connect", ssid];
  if (password) args.push("password", password);
  const { stderr, code } = await exec.run(args);
  if (code !== 0) throw new Error(translateConnectError(stderr));
}
