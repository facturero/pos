import { Hono } from "hono";
import bcrypt from "bcryptjs";
import argon2 from "argon2";
import { z } from "zod";
import { prisma } from "../db.js";
import { signToken } from "../utils/jwt.js";
import { validateRemoteCredentials } from "../sync/admin-client.js";

export const authRoutes = new Hono();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// Login local del POS — valida SIEMPRE contra el hash guardado localmente,
// así el cajero entra sin internet.
//
// - Usuarios sincronizados desde el CRM (remoteId != null): el sync baja el
//   hash argon2id del CRM y se valida aquí mismo con argon2. Si el sync
//   todavía no trajo el hash (usuario nuevo/sin contraseña), se cae a
//   validateRemoteCredentials() como último recurso y se vincula el hash.
// - Usuarios creados 100% localmente (seed/consola): hash bcrypt local desde
//   el principio, se valida con bcrypt aquí mismo.
function isArgon2Hash(hash: string): boolean {
  return hash.startsWith("$argon2");
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (isArgon2Hash(hash)) {
    return argon2.verify(hash, password);
  }
  return bcrypt.compare(password, hash);
}

authRoutes.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Datos inválidos" }, 400);
  }

  const { username, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.active) {
    return c.json({ error: "Usuario o contraseña incorrectos" }, 401);
  }

  if (user.passwordHash) {
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return c.json({ error: "Contraseña incorrecta" }, 401);
    }
    return c.json({
      token: signToken({ sub: user.id, username: user.username, role: user.role }),
      passwordLinked: false,
      user: { id: user.id, name: user.name, username: user.username, role: user.role },
    });
  }

  // Sin hash local: el sync aún no trajo la contraseña (usuario recién creado
  // en el CRM o cuenta sin contraseña). Como última opción, validar contra el
  // CRM y, si es válida, guardar el hash para que el próximo login sea offline.
  // auth-service valida por email, así que usamos el email del CRM guardado en
  // el sync (con fallback al username por compatibilidad con syncs viejos).
  try {
    const valid = await validateRemoteCredentials(user.email ?? user.username, password);
    if (!valid) {
      return c.json({ error: "Contraseña incorrecta" }, 401);
    }
  } catch {
    return c.json(
      {
        error:
          "Sin conexión con el CRM. Espera a que el POS sincronice este usuario y su contraseña, o revísalo desde el CRM.",
      },
      401,
    );
  }

  const hash = await argon2.hash(password);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });

  const token = signToken({ sub: user.id, username: user.username, role: user.role });

  return c.json({
    token,
    passwordLinked: true,
    user: { id: user.id, name: user.name, username: user.username, role: user.role },
  });
});
