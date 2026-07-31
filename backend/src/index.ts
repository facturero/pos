import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authRoutes } from "./routes/auth.routes.js";
import { categoryRoutes } from "./routes/categories.routes.js";
import { productRoutes } from "./routes/products.routes.js";
import { saleRoutes } from "./routes/sales.routes.js";
import { cashSessionRoutes } from "./routes/cash-sessions.routes.js";
import { syncRoutes } from "./routes/sync.routes.js";
import { startSyncScheduler } from "./sync/scheduler.js";

const app = new Hono();

app.use("*", logger());
// Solo escucha en localhost, así que CORS aquí es únicamente para que la
// webview de Tauri (origen distinto) pueda llamar a esta API.
app.use("*", cors());

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/auth", authRoutes);
app.route("/categories", categoryRoutes);
app.route("/products", productRoutes);
app.route("/sales", saleRoutes);
app.route("/cash-sessions", cashSessionRoutes);
app.route("/sync", syncRoutes);

const port = Number(process.env.PORT ?? 4000);

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`POS backend escuchando en http://127.0.0.1:${info.port}`);
  startSyncScheduler();
});
