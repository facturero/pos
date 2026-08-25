// Identidad estable del equipo: un UUID que nace en el primer arranque y no
// cambia mientras dure la instalación. Es lo que el POS envía en /pair para
// que el CRM (organization-service + auth-service) lo identifique como
// dispositivo, y la llave por la que el gateway hub le enruta la
// desvinculación por socket.io (`device:<deviceId>`).

import { randomUUID } from "node:crypto";
import { prisma } from "./db.js";

let cachedDeviceId: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  let identity = await prisma.posIdentity.findUnique({ where: { id: 1 } });
  if (!identity) {
    identity = await prisma.posIdentity.create({
      data: { id: 1, deviceId: randomUUID() },
    });
  }

  cachedDeviceId = identity.deviceId;
  return cachedDeviceId;
}
