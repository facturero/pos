import { prisma } from "../db.js";
import { pushRemoteSale } from "./admin-client.js";
import { getDeviceId } from "../device-identity.js";

// Sube al admin las ventas locales pendientes (`synced: false`).
// Se procesan una por una y de forma idempotente: si falla la venta N,
// las siguientes igual se intentan (un error de una venta no debe
// bloquear el resto de la cola). Los errores quedan guardados en
// `syncError` para poder revisarlos sin mirar logs.
//
// Del otro lado, billing-service convierte cada venta en una factura EMITIDA
// (POST /invoices/from-pos). La idempotencia es suya: la clave es este terminal
// más el id local de la venta, así que reintentar una venta ya subida devuelve
// la misma factura en vez de duplicarla. El id del terminal es el deviceId —
// estable por equipo — y NO una variable de entorno: dos cajas con el mismo
// valor compartirían clave y una podría darse por subida con la factura de la
// otra.
export async function pushToAdmin(): Promise<{ pushed: number; failed: number }> {
  const config = await prisma.posConfig.findUnique({ where: { id: 1 } });
  if (!config) {
    // Sin emparejar no hay a qué organización ni punto de emisión facturar.
    // No es un error de la cola: las ventas esperan a que se empareje.
    return { pushed: 0, failed: 0 };
  }

  const terminalId = await getDeviceId();

  const pending = await prisma.sale.findMany({
    where: { synced: false, status: "COMPLETED" },
    include: {
      items: { include: { product: true } },
      customer: { select: { remoteId: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 50, // en lotes, para no saturar si hubo varios días offline
  });

  let pushed = 0;
  let failed = 0;

  for (const sale of pending) {
    try {
      // El CRM factura por producto del catálogo. Un artículo que no vino de
      // allí (sin remoteId) no se puede facturar: se marca el motivo y se deja
      // la venta en la cola en vez de subir una factura con líneas inventadas.
      const sinCatalogo = sale.items.filter((item) => !item.product.remoteId);
      if (sinCatalogo.length > 0) {
        const nombres = sinCatalogo.map((i) => i.product.name).join(", ");
        throw new Error(`Hay artículos que no existen en el catálogo del CRM: ${nombres}`);
      }

      const remote = await pushRemoteSale({
        terminalId,
        posSaleId: String(sale.id),
        establishmentId: config.establishmentId,
        emissionPointId: config.emissionPointId,
        customerId: sale.customer?.remoteId ?? null,
        posTotalCents: Math.round(Number(sale.total) * 100),
        lines: sale.items.map((item) => ({
          productId: item.product.remoteId as string,
          description: item.product.name,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice).toFixed(2),
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
