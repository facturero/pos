import { prisma } from "../db.js";
import { pushRemoteSale } from "./admin-client.js";

const TERMINAL_ID = process.env.TERMINAL_ID ?? "pos-desconocido";

// Sube al admin las ventas locales pendientes (`synced: false`).
// Se procesan una por una y de forma idempotente: si falla la venta N,
// las siguientes igual se intentan (un error de una venta no debe
// bloquear el resto de la cola). Los errores quedan guardados en
// `syncError` para poder revisarlos sin mirar logs.
export async function pushToAdmin(): Promise<{ pushed: number; failed: number }> {
  const pending = await prisma.sale.findMany({
    where: { synced: false, status: "COMPLETED" },
    include: {
      items: { include: { product: true } },
      user: { select: { username: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 50, // en lotes, para no saturar si hubo varios días offline
  });

  let pushed = 0;
  let failed = 0;

  for (const sale of pending) {
    try {
      const remote = await pushRemoteSale({
        terminalId: TERMINAL_ID,
        localSaleId: sale.id,
        cashierUsername: sale.user.username,
        subtotal: Number(sale.subtotal),
        tax: Number(sale.tax),
        discount: Number(sale.discount),
        total: Number(sale.total),
        paymentMethod: sale.paymentMethod,
        createdAt: sale.createdAt.toISOString(),
        items: sale.items.map((item: (typeof sale.items)[number]) => ({
          productRemoteId: item.product.remoteId,
          sku: item.product.sku,
          name: item.product.name,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          subtotal: Number(item.subtotal),
        })),
      });

      await prisma.sale.update({
        where: { id: sale.id },
        data: { synced: true, syncedAt: new Date(), remoteId: remote.id, syncError: null },
      });
      pushed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      await prisma.sale.update({ where: { id: sale.id }, data: { syncError: message } });
      failed++;
    }
  }

  await prisma.syncLog.create({
    data: {
      direction: "PUSH",
      status: failed > 0 ? "ERROR" : "SUCCESS",
      itemCount: pushed,
      message: failed > 0 ? `${failed} venta(s) fallaron al subir` : null,
    },
  });

  return { pushed, failed };
}
