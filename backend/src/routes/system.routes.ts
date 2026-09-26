import { Hono } from "hono";
import { version } from "../version.js";
import { readNetwork } from "../system/network.js";

export const systemRoutes = new Hono();

// Datos de solo lectura para la barra inferior de la pantalla: versión instalada y por dónde sale el equipo
// a la red (cable / Wi-Fi / sin red). Sin autenticación a propósito (la barra se ve también en el login y el
// emparejamiento) y sin nada sensible: el backend solo escucha en 127.0.0.1.
systemRoutes.get("/info", (c) => c.json({ version: version ?? null, network: readNetwork() }));
