import { Hono } from "hono";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import type { JwtPayload } from "../utils/jwt.js";
import { getSyncState } from "../sync/status.js";
import { emitSyncState } from "../local/socket.js";
import { computeSale, toCents, type LineTaxRate } from "../tax/sale-totals.js";

export const saleRoutes = new Hono<{ Variables: { user: JwtPayload } }>();

saleRoutes.use("*", authMiddleware);

const saleItemSchema = z.object({
  productId: z.number().int(),
  quantity: z.number().positive(),
});

const createSaleSchema = z.object({
  cashSessionId: z.number().int(),
  customerId: z.number().int().optional(),
  items: z.array(saleItemSchema).min(1),
  // Descuento de la venta, en la moneda (no en centavos). Se reparte entre las líneas.
  discount: z.number().nonnegative().default(0),
  // Compatibilidad: el impuesto YA NO lo escribe el cajero. Se calcula por producto con
  // las tasas del CRM; si un cliente antiguo lo manda, se ignora.
  tax: z.number().optional(),
  paymentMethod: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]).default("CASH"),
});

const previewSaleSchema = z.object({
  items: z.array(saleItemSchema),
  discount: z.number().nonnegative().default(0),
});

type ProductForTax = { id: number; name: string; price: unknown; priceIncludesTax: boolean; taxes: unknown };

// Lee las tasas guardadas de un producto ([{ taxRateId, kind, percentage }]). `null` en la
// base = el producto aún no se sincronizó con datos de impuestos. En ese caso NO se cobra:
// asumir "sin IVA" haría que la caja cobre menos de lo que dirá la factura del CRM.
function taxRatesOf(product: ProductForTax): LineTaxRate[] {
  if (!Array.isArray(product.taxes)) {
    throw new Error(
      `El producto "${product.name}" no tiene sus impuestos sincronizados; sincroniza el catálogo con el CRM antes de venderlo`,
    );
  }
  return (product.taxes as Array<{ taxRateId?: string; kind?: string; percentage?: number }>).map((t) => ({
    taxRateId: t.taxRateId,
    kind: t.kind ?? "vat",
    percentage: Number(t.percentage ?? 0),
  }));
}

// Calcula los totales de una venta con el IVA de CADA producto (mismo algoritmo que
// billing-service; ver src/tax/sale-totals.ts). Lo usan la venta real y la vista previa
// del carrito, para que lo que ve el cajero sea exactamente lo que se cobra y se factura.
function priceSale(
  items: Array<{ productId: number; quantity: number }>,
  productsById: Map<number, ProductForTax>,
  discount: number,
) {
  const lines = items.map((item) => {
    const product = productsById.get(item.productId);
    if (!product) throw new Error(`Producto ${item.productId} no encontrado`);
    return {
      productId: product.id,
      quantity: item.quantity,
      unitPrice: Number(product.price),
      input: {
        unitPriceCents: toCents(Number(product.price)),
        quantity: item.quantity,
        priceIncludesTax: product.priceIncludesTax,
        taxes: taxRatesOf(product),
      },
    };
  });
  const result = computeSale(lines.map((l) => l.input), toCents(discount));
  return { lines, result };
}

const money = (cents: number) => cents / 100;

// Vista previa de los totales del carrito (no guarda nada ni exige caja abierta). El
// frontend la consulta al cambiar el carrito, así la única implementación del cálculo
// está aquí y la pantalla no puede desviarse de lo que se cobrará.
saleRoutes.post("/preview", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = previewSaleSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const { items, discount } = parsed.data;

  try {
    const products = await prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } });
    const { lines, result } = priceSale(items, new Map(products.map((p) => [p.id, p])), discount);
    return c.json({
      subtotal: money(result.subtotalCents),
      tax: money(result.taxCents),
      discount,
      total: money(result.totalCents),
      taxBreakdown: result.taxBreakdown.map((b) => ({
        kind: b.kind,
        percentage: b.percentage,
        base: money(b.baseCents),
        amount: money(b.amountCents),
      })),
      lines: lines.map((l, i) => ({
        productId: l.productId,
        subtotal: money(result.lines[i].subtotalCents),
        discount: money(result.lineDiscountsCents[i]),
        tax: money(result.lines[i].taxCents),
        total: money(result.lines[i].totalCents),
      })),
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "No se pudo calcular la venta" }, 400);
  }
});

// Crea la venta 100% local (funciona con o sin internet). Queda marcada
// `synced: false` y el módulo de sync (src/sync) se encarga de subirla
// al admin en segundo plano apenas haya conexión.
saleRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);
  const parsed = createSaleSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const { cashSessionId, customerId, items, discount, paymentMethod } = parsed.data;

  // Si no se elige cliente, asignar CONSUMIDOR FINAL (id=1, siempre existe)
  const finalCustomerId = customerId ?? 1;

  try {
    const sale = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const session = await tx.cashSession.findUnique({ where: { id: cashSessionId } });
      if (!session || session.status !== "OPEN") {
        throw new Error("La sesión de caja no está abierta");
      }

      const products = await tx.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } });
      for (const item of items) {
        const product = products.find((p) => p.id === item.productId);
        if (!product || !product.active) {
          throw new Error(`Producto ${item.productId} no encontrado`);
        }
        // Sin control de stock por ahora: la venta siempre se permite; cuando exista la
        // decisión de negocio (¿vender sin stock? ¿qué hace la caja offline?), este es el
        // lugar para reintroducir la validación.
      }

      const { lines, result } = priceSale(items, new Map(products.map((p) => [p.id, p])), discount);

      const itemsData = lines.map((l, i) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitPrice: l.unitPrice, // precio del catálogo (con IVA si el producto lo incluye)
        subtotal: money(result.lines[i].subtotalCents), // base sin impuestos, ya descontada
        discount: money(result.lineDiscountsCents[i]),
        taxAmount: money(result.lines[i].taxCents),
        taxes: result.lines[i].taxes.map((t) => ({
          kind: t.kind,
          percentage: t.percentage,
          baseCents: t.baseCents,
          amountCents: t.amountCents,
        })),
      }));

      return tx.sale.create({
        data: {
          cashSessionId,
          userId: user.sub,
          customerId: finalCustomerId,
          subtotal: money(result.subtotalCents), // suma de bases = subtotal de la factura
          tax: money(result.taxCents),
          discount,
          total: money(result.totalCents),
          paymentMethod,
          items: { create: itemsData },
        },
        include: { items: { include: { product: true } }, customer: true },
      });
    });

    // La venta queda pendiente de subir: avisamos al frontend para que el
    // indicador de "ventas por sincronizar" cambie al instante (sin polling).
    void getSyncState()
      .then((state) => emitSyncState(state))
      .catch(() => undefined);

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
    include: { items: { include: { product: true } }, user: { select: { name: true } }, customer: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return c.json(sales);
});

saleRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: { items: { include: { product: true } }, user: { select: { name: true } }, customer: true },
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

      // Sin reposición de stock: no se descuenta al vender (ver nota arriba),
      // así que tampoco hay nada que reponer al anular.

      return tx.sale.update({ where: { id }, data: { status: "VOIDED" } });
    });

    return c.json(sale);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al anular la venta";
    return c.json({ error: message }, 400);
  }
});
