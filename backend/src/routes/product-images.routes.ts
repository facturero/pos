import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { prisma } from "../db.js";
import { imagePath } from "../sync/images.js";

// Sirve las imágenes de producto ya descargadas (ver src/sync/images.ts).
// Sin authMiddleware a propósito: un <img src> no puede mandar el token, y el backend solo
// escucha en 127.0.0.1. El id del archivo es un uuid y solo se sirve lo que hay en disco.
export const productImageRoutes = new Hono();

productImageRoutes.get("/:fileId", async (c) => {
  const file = imagePath(c.req.param("fileId"));
  if (!file) return c.body(null, 404);
  const product = await prisma.product.findFirst({
    where: { imageFileId: c.req.param("fileId") },
    select: { imageMime: true },
  });
  if (!product?.imageMime) return c.body(null, 404);
  try {
    const bytes = await readFile(file);
    // El id cambia cuando cambia la imagen, así que la copia puede cachearse para siempre.
    return c.body(bytes, 200, {
      "Content-Type": product.imageMime,
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  } catch {
    return c.body(null, 404);
  }
});
