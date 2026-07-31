import { Hono } from "hono";
import { prisma } from "../db.js";
import { authMiddleware } from "../middleware/auth.js";

// Solo lectura: las categorías se sincronizan desde el admin, no se crean
// manualmente en el POS (evita que un producto quede "huérfano" localmente
// sin existir en el sistema central).
export const categoryRoutes = new Hono();

categoryRoutes.use("*", authMiddleware);

categoryRoutes.get("/", async (c) => {
  const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });
  return c.json(categories);
});
