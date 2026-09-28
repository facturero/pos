import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { prisma } from "../db.js";
import { assetPath } from "../theme/assets.js";
import { getCurrentTheme } from "../theme/service.js";

// El tema visual de ESTA caja (copia local del que resuelve el CRM). Sin autenticación a
// propósito: el login y la pantalla de emparejamiento también se ven con la marca, y un <img src>
// no puede mandar el token. El backend solo escucha en 127.0.0.1 y aquí no hay nada sensible.
export const themeRoutes = new Hono();

themeRoutes.get("/", async (c) => c.json(await getCurrentTheme()));

// Imágenes de marca ya descargadas. Solo se sirve lo que el tema guardado declara (con su mime),
// nunca un archivo arbitrario del directorio. El id cambia cuando cambia la imagen: cacheable.
themeRoutes.get("/assets/:fileId", async (c) => {
  const fileId = c.req.param("fileId");
  const file = assetPath(fileId);
  if (!file) return c.body(null, 404);
  const row = await prisma.posTheme.findUnique({ where: { id: 1 }, select: { assetsJson: true } });
  let mime: string | null = null;
  try {
    const assets = JSON.parse(row?.assetsJson ?? "[]") as { fileId: string; mime: string | null }[];
    mime = assets.find((a) => a.fileId === fileId)?.mime ?? null;
  } catch {
    mime = null;
  }
  if (!mime) return c.body(null, 404);
  try {
    return c.body(await readFile(file), 200, {
      "Content-Type": mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      // Un SVG servido directo no debe poder ejecutar nada aunque alguien lo abra fuera de un <img>.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    });
  } catch {
    return c.body(null, 404);
  }
});
