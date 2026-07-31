import type { Context, Next } from "hono";
import { verifyToken } from "../utils/jwt.js";

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
    c.set("user", payload);
    await next();
  } catch {
    return c.json({ error: "Token inválido o expirado" }, 401);
  }
}

export async function requireAdmin(c: Context, next: Next) {
  const user = c.get("user");
  if (user?.role !== "ADMIN") {
    return c.json({ error: "Requiere permisos de administrador" }, 403);
  }
  await next();
}
