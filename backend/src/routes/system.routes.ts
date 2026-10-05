import { Hono } from "hono";
import { z } from "zod";
import { version } from "../version.js";
import { readNetwork } from "../system/network.js";
import { posMode } from "../system/mode.js";
import { computeGate, readUpdateStatus, recordActivity, requestUpdateNow } from "../system/update.js";
import { powerOff, reboot } from "../system/power.js";
import { connect as connectWifi, listNetworks } from "../system/wifi.js";
import { getSyncSummary } from "../sync/status.js";

export const systemRoutes = new Hono();

// Datos de solo lectura para la barra inferior de la pantalla: versión instalada, por dónde sale el equipo
// a la red (cable / Wi-Fi / sin red) y el modo de despliegue (kiosk/desktop — StatusBar.vue lo usa para
// decidir si muestra hora/apagar/reiniciar, que en modo desktop ya da el propio Windows). Sin autenticación
// a propósito (la barra se ve también en el login y el emparejamiento) y sin nada sensible: el backend solo
// escucha en 127.0.0.1.
systemRoutes.get("/info", (c) => c.json({ version: version ?? null, network: readNetwork(), mode: posMode }));

// Resumen para el panel de sincronización de la barra de estado (ícono con la ruedita): catálogo,
// clientes y usuarios YA sincronizados (conteo real de las tablas locales, no lo que se bajó en la
// última corrida), más el último pull/push y las ventas pendientes. Sin autenticación, igual que
// /info: no hay nada sensible y el backend solo escucha en 127.0.0.1.
systemRoutes.get("/sync-summary", async (c) => {
  try {
    return c.json(await getSyncSummary());
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "No se pudo leer el resumen" }, 500);
  }
});

// Actualización en dos tiempos (ver system/update.ts y os/release/update-gate.mjs). Todo sin
// autenticación, igual que el resto de /system: el backend solo escucha en 127.0.0.1 y nada de esto
// expone datos del negocio.
// - /update-status: la pantalla pregunta si hay una versión nueva descargada esperando buen momento.
// - /activity: latido de la pantalla (carrito y tiempo ocioso) para decidir cuándo es seguro aplicar.
// - /update-gate: lo consulta la compuerta del actualizador.
// - /update-now: el botón "Actualizar ahora".
systemRoutes.get("/update-status", (c) => c.json({ pending: readUpdateStatus() }));
systemRoutes.get("/update-gate", async (c) => {
  try {
    return c.json(await computeGate());
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "No se pudo evaluar" }, 500);
  }
});
const activitySchema = z.object({ cartCount: z.number().int().min(0), idleMs: z.number().min(0) });
systemRoutes.post("/activity", async (c) => {
  const parsed = activitySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Latido inválido" }, 400);
  recordActivity(parsed.data.cartCount, parsed.data.idleMs);
  return c.json({ ok: true });
});
systemRoutes.post("/update-now", (c) => c.json({ ok: requestUpdateNow() }));

// Apagar/reiniciar: sin autenticación a propósito, igual que /info — quien tiene acceso físico al
// kiosco ya podría apagarlo tirando del cable o manteniendo el botón de encendido; esto solo evita
// eso. El frontend pide confirmación antes de llamar. El equipo se apaga/reinicia de verdad: no hay
// vuelta atrás desde aquí.
// En modo desktop no existen (Windows ya los da su propia barra de tareas y no hay sudoers/systemctl
// que ejecutar): el frontend ya oculta los botones, pero la ruta responde explícito en vez de dejar
// que reviente con el error críptico de "sudo" no encontrado.
systemRoutes.post("/poweroff", async (c) => {
  if (posMode === "desktop") return c.json({ error: "Apagar no está disponible en modo desktop" }, 400);
  try {
    await powerOff();
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "No se pudo apagar el equipo" }, 500);
  }
});

systemRoutes.post("/reboot", async (c) => {
  if (posMode === "desktop") return c.json({ error: "Reiniciar no está disponible en modo desktop" }, 400);
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
