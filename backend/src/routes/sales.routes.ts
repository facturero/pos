import { Hono } from "hono";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import type { JwtPayload } from "../utils/jwt.js";

export const saleRoutes = new Hono<{ Variables: { user: JwtPayload } }>();

saleRoutes.use("*", authMiddleware);

const saleItemSchema = z.object({
  productId: z.number().int(),
  quantity: z.number().positive(),
});

const createSaleSchema = z.object({
  cashSessionId: z.number().int(),
  items: z.array(saleItemSchema).min(1),
  discount: z.number().nonnegative().default(0),
  tax: z.number().nonnegative().default(0),
  paymentMethod: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]).default("CASH"),
});

// Crea la venta 100% local (funciona con o sin internet). Queda marcada
// `synced: false` y el módulo de sync (src/sync) se encarga de subirla
// al admin en segundo plano apenas haya conexión.
saleRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);
  const parsed = createSaleSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const { cashSessionId, items, discount, tax, paymentMethod } = parsed.data;

  try {
    const sale = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const session = await tx.cashSession.findUnique({ where: { id: cashSessionId } });
      if (!session || session.status !== "OPEN") {
        throw new Error("La sesión de caja no está abierta");
      }

      let subtotal = 0;
      const itemsData = [];

      for (const item of items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product || !product.active) {
          throw new Error(`Producto ${item.productId} no encontrado`);
        }
        if (Number(product.stock) < item.quantity) {
          throw new Error(`Stock insuficiente para "${product.name}"`);
        }

        const unitPrice = Number(product.price);
        const lineSubtotal = unitPrice * item.quantity;
        subtotal += lineSubtotal;

        itemsData.push({
          productId: product.id,
          quantity: item.quantity,
          unitPrice,
          subtotal: lineSubtotal,
        });

        await tx.product.update({
          where: { id: product.id },
          data: { stock: { decrement: item.quantity } },
        });
      }

      const total = subtotal + tax - discount;

      return tx.sale.create({
        data: {
          cashSessionId,
          userId: user.sub,
          subtotal,
          tax,
          discount,
          total,
          paymentMethod,
          items: { create: itemsData },
        },
        include: { items: { include: { product: true } } },
      });
    });

    return c.json(sale, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al procesar la venta";
    return c.json({ error: message }, 400);
  }
});

saleRoutes.get("/", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");

  const sales = await prisma.sale.findMany({
    where: {
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    },
    include: { items: { include: { product: true } }, user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return c.json(sales);
});

saleRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: { items: { include: { product: true } }, user: { select: { name: true } } },
  });
  if (!sale) return c.json({ error: "Venta no encontrada" }, 404);
  return c.json(sale);
});

saleRoutes.post("/:id/void", async (c) => {
  const id = Number(c.req.param("id"));

  try {
    const sale = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existing = await tx.sale.findUnique({ where: { id }, include: { items: true } });
      if (!existing || existing.status === "VOIDED") {
        throw new Error("Venta no encontrada o ya anulada");
      }

      for (const item of existing.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: Number(item.quantity) } },
        });
      }

      return tx.sale.update({ where: { id }, data: { status: "VOIDED" } });
    });

    return c.json(sale);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al anular la venta";
    return c.json({ error: message }, 400);
  }
});
