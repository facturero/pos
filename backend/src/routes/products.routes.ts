import { Hono } from "hono";
import { prisma } from "../db.js";
import { authMiddleware } from "../middleware/auth.js";

// Catálogo de solo lectura para el POS: los productos y precios vienen
// SIEMPRE del admin vía sincronización (ver src/sync). El POS nunca
// crea/edita productos directamente, para que nunca haya divergencia
// entre lo que cobra la caja y lo que dice el sistema central.
export const productRoutes = new Hono();

productRoutes.use("*", authMiddleware);

productRoutes.get("/", async (c) => {
  const search = c.req.query("search");
  const barcode = c.req.query("barcode");

  if (barcode) {
    const product = await prisma.product.findFirst({
      where: { barcode, active: true },
      include: { category: true },
    });
    return c.json(product ? [product] : []);
  }

  const products = await prisma.product.findMany({
    where: {
      active: true,
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { sku: { contains: search } },
              { barcode: { contains: search } },
            ],
          }
        : {}),
    },
    include: { category: true },
    orderBy: { name: "asc" },
    take: 100,
  });

  return c.json(products);
});

productRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const product = await prisma.product.findUnique({ where: { id }, include: { category: true } });
  if (!product) return c.json({ error: "Producto no encontrado" }, 404);
  return c.json(product);
});
