import { Hono } from "hono";
import { prisma } from "../db.js";
import { authMiddleware } from "../middleware/auth.js";

export const customerRoutes = new Hono();

customerRoutes.use("*", authMiddleware);

customerRoutes.get("/", async (c) => {
  const q = c.req.query("q")?.trim() ?? "";

  // Un cliente desactivado en el CRM sigue guardado (sus ventas lo referencian) pero no se ofrece para vender.
  // Visto el 2026-10-05: lo desactivado en el CRM seguía saliendo en el buscador de la caja.
  const where = q
    ? {
        status: "ACTIVE" as const,
        OR: [
          { businessName: { contains: q } },
          { tradeName: { contains: q } },
          { identification: { contains: q } },
          { email: { contains: q } },
          { phone: { contains: q } },
        ],
      }
    : { status: "ACTIVE" as const };

  const [results, consumidor] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { businessName: "asc" },
      take: 50,
    }),
    prisma.customer.findUnique({ where: { id: 1 } }),
  ]);

  // Siempre incluir CONSUMIDOR FINAL (id=1) al inicio
  const all = [consumidor, ...results.filter((r) => r.id !== 1)].filter(Boolean);

  return c.json(all);
});
