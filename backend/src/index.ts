import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authRoutes } from "./routes/auth.routes.js";
import { categoryRoutes } from "./routes/categories.routes.js";
import { productRoutes } from "./routes/products.routes.js";
import { productImageRoutes } from "./routes/product-images.routes.js";
import { saleRoutes } from "./routes/sales.routes.js";
import { cashSessionRoutes } from "./routes/cash-sessions.routes.js";
import { customerRoutes } from "./routes/customers.routes.js";
import { syncRoutes } from "./routes/sync.routes.js";
import { setupRoutes } from "./routes/setup.routes.js";
import { startSyncScheduler } from "./sync/scheduler.js";
import { startRealtime } from "./sync/realtime.js";
import { startLocalSocket } from "./local/socket.js";
import { prisma } from "./db.js";

const app = new Hono();

app.use("*", logger());
// Solo escucha en localhost, así que CORS aquí es únicamente para que la
// webview de Tauri (origen distinto) pueda llamar a esta API.
app.use("*", cors());

// Versión de la instalación (archivo VERSION junto al dist, lo genera el
// release). El actualizador la usa para decidir si la versión que bajó es la
// que realmente quedó activa. En desarrollo no existe el archivo: sin versión.
function readVersion(): string | undefined {
  try {
    const value = readFileSync(new URL("./VERSION", import.meta.url), "utf8").trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

const version = readVersion();

app.get("/health", async (c) => {
  try {
    // SELECT 1: si la BD no responde, la instalación no sirve para vender
    // (catálogo, ventas y cola viven en ella). El actualizador espera 200
    // antes de dar una versión por buena.
    await prisma.$queryRaw`SELECT 1`;
    return c.json(version ? { status: "ok", version } : { status: "ok" });
  } catch {
    return c.json({ status: "error" }, 503);
  }
});

app.route("/auth", authRoutes);
app.route("/categories", categoryRoutes);
app.route("/products", productRoutes);
app.route("/product-images", productImageRoutes);
app.route("/sales", saleRoutes);
app.route("/cash-sessions", cashSessionRoutes);
app.route("/customers", customerRoutes);
app.route("/sync", syncRoutes);
app.route("/setup", setupRoutes);

// En producción el backend sirve también la pantalla compilada (un solo
// origen; la ventana de Tauri solo abre http://127.0.0.1:4000). Sin
// POS_FRONTEND_DIST (modo desarrollo) no se sirve nada: el frontend corre
// en su propio server de Vite.
const frontendDist = process.env.POS_FRONTEND_DIST;

if (frontendDist) {
  app.use("*", serveStatic({ root: frontendDist }));
  // Sin archivo en disco: es una ruta de la SPA en modo history (navegaciones
  // internas de Vue Router). index.html es pequeño; se sirve entero solo a GET
  // de navegación. Una API inexistente sigue obteniendo un 404 JSON.
  app.get("*", (c) => {
    const accept = c.req.header("Accept") ?? "";
    if (!accept.includes("text/html")) {
      return c.json({ error: "No encontrado" }, 404);
    }
    try {
      const html = readFileSync(join(frontendDist, "index.html"), "utf8");
      return c.html(html);
    } catch {
      return c.json({ error: "No encontrado" }, 404);
    }
  });
}

const port = Number(process.env.PORT ?? 4000);

const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`POS backend escuchando en http://127.0.0.1:${info.port}`);
  startSyncScheduler();
  startRealtime();
});

// El canal de tiempo real local (socket.io) se monta sobre el MISMO server
// cuando el backend sirve la pantalla (producción): la webview y el socket
// comparten origen. En desarrollo sigue viviendo en su propio puerto.
startLocalSocket({ server: frontendDist ? server : undefined });
