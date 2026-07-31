import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import type { JwtPayload } from "../utils/jwt.js";

export const cashSessionRoutes = new Hono<{ Variables: { user: JwtPayload } }>();

cashSessionRoutes.use("*", authMiddleware);

cashSessionRoutes.get("/current", async (c) => {
  const user = c.get("user");
  const session = await prisma.cashSession.findFirst({
    where: { userId: user.sub, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });
  return c.json(session);
});

const openSchema = z.object({ openingAmount: z.number().nonnegative() });

cashSessionRoutes.post("/open", async (c) => {
  const user = c.get("user");

  const existing = await prisma.cashSession.findFirst({
    where: { userId: user.sub, status: "OPEN" },
  });
  if (existing) {
    return c.json({ error: "Ya tienes una caja abierta" }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = openSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Monto inválido" }, 400);

  const session = await prisma.cashSession.create({
    data: { userId: user.sub, openingAmount: parsed.data.openingAmount },
  });

  return c.json(session, 201);
});

const closeSchema = z.object({
  closingAmount: z.number().nonnegative(),
  notes: z.string().optional(),
});

cashSessionRoutes.post("/:id/close", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => null);
  const parsed = closeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Monto inválido" }, 400);

  const session = await prisma.cashSession.findUnique({
    where: { id },
    include: { sales: { where: { status: "COMPLETED" } } },
  });
  if (!session || session.status === "CLOSED") {
    return c.json({ error: "Sesión no encontrada o ya cerrada" }, 400);
  }

  const cashSalesTotal = session.sales
    .filter((s: (typeof session.sales)[number]) => s.paymentMethod === "CASH")
    .reduce((sum: number, s: (typeof session.sales)[number]) => sum + Number(s.total), 0);

  const expectedAmount = Number(session.openingAmount) + cashSalesTotal;

  const updated = await prisma.cashSession.update({
    where: { id },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      closingAmount: parsed.data.closingAmount,
      expectedAmount,
      notes: parsed.data.notes,
    },
  });

  return c.json(updated);
});
