import type { Context, Next } from "hono";
import { verifyToken } from "../utils/jwt.js";
import { prisma } from "../db.js";
import { hasPosAccess } from "../sync/permissions.js";

// Autenticación local del POS (cajero vs administrador). El backend solo
// escucha en 127.0.0.1, así que esto protege el uso multi-usuario en el
// mismo equipo, no un ataque externo — eso lo cubre el firewall + lockdown del OS.
export async function authMiddleware(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "No autorizado" }, 401);
  }

  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyToken(token);
    // La firma sola no basta: el token dura 12 h y lleva el rol de cuando se inició sesión. Se mira al usuario
    // EN LA BASE en cada petición para que deshabilitarlo en el CRM, o cambiarle el rol, surta efecto en la sesión
    // que ya tiene abierta y no solo en el siguiente login (visto el 2026-10-05: un cajero deshabilitado seguía
    // cobrando con su sesión). Una consulta por clave primaria en SQLite local cuesta microsegundos.
    const current = await prisma.user.findUnique({ where: { id: payload.sub }, select: { active: true, role: true, permissions: true } });
    if (!current || !current.active) {
      return c.json({ error: "Tu usuario fue desactivado. Inicia sesión de nuevo o consulta al administrador." }, 401);
    }
    // El acceso sale del PERMISO `pos:access` que el CRM da a los roles del usuario (ver sync/permissions.ts), no del
    // nombre del rol: quitárselo en el CRM le cierra la sesión que ya tiene abierta.
    if (!hasPosAccess(current.permissions)) {
      return c.json({ error: "Tu usuario no tiene acceso al POS. Pide al administrador el permiso «pos:access»." }, 401);
    }
    c.set("user", { ...payload, role: current.role });
  } catch {
    return c.json({ error: "Token inválido o expirado" }, 401);
  }
  await next();
}

export async function requireAdmin(c: Context, next: Next) {
  const user = c.get("user");
  if (user?.role !== "ADMIN") {
    return c.json({ error: "Requiere permisos de administrador" }, 403);
  }
  await next();
}
