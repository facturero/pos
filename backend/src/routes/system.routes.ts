import { Hono } from "hono";
import { z } from "zod";
import { version } from "../version.js";
import { readNetwork } from "../system/network.js";
import { powerOff, reboot } from "../system/power.js";
import { connect as connectWifi, listNetworks } from "../system/wifi.js";

export const systemRoutes = new Hono();

// Datos de solo lectura para la barra inferior de la pantalla: versión instalada y por dónde sale el equipo
// a la red (cable / Wi-Fi / sin red). Sin autenticación a propósito (la barra se ve también en el login y el
// emparejamiento) y sin nada sensible: el backend solo escucha en 127.0.0.1.
systemRoutes.get("/info", (c) => c.json({ version: version ?? null, network: readNetwork() }));

// Apagar/reiniciar: sin autenticación a propósito, igual que /info — quien tiene acceso físico al
// kiosco ya podría apagarlo tirando del cable o manteniendo el botón de encendido; esto solo evita
// eso. El frontend pide confirmación antes de llamar. El equipo se apaga/reinicia de verdad: no hay
// vuelta atrás desde aquí.
systemRoutes.post("/poweroff", async (c) => {
  try {
    await powerOff();
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "No se pudo apagar el equipo" }, 500);
  }
});

systemRoutes.post("/reboot", async (c) => {
  try {
    await reboot();
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "No se pudo reiniciar el equipo" }, 500);
  }
});

// Wi-Fi: listar redes visibles y conectar. Sin autenticación, igual que el resto de /system — nada de
// esto sale del equipo (nmcli habla con el NetworkManager local, no con el CRM).
systemRoutes.get("/wifi/networks", async (c) => {
  try {
    return c.json(await listNetworks());
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "No se pudo escanear redes Wi-Fi" }, 500);
  }
});

const wifiConnectSchema = z.object({
  ssid: z.string().min(1),
  password: z.string().min(1).optional(),
});

systemRoutes.post("/wifi/connect", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = wifiConnectSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Falta el nombre de la red" }, 400);
  try {
    await connectWifi(parsed.data.ssid, parsed.data.password);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "No se pudo conectar" }, 400);
  }
});
