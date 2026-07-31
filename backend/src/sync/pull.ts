import { prisma } from "../db.js";
import { fetchRemoteCategories, fetchRemoteProducts } from "./admin-client.js";

// Baja categorías y productos del admin y los deja espejados localmente
// por `remoteId`. Es un upsert: si el producto ya existe localmente
// (por remoteId) lo actualiza, si no, lo crea. Nunca borra productos
// localmente aunque desaparezcan del admin (por seguridad ante errores
// de red a mitad de sync); en su lugar, si tu admin manda `active:false`,
// aquí se refleja igual.
export async function pullFromAdmin(): Promise<{ categories: number; products: number }> {
  const remoteCategories = await fetchRemoteCategories();

  const categoryIdMap = new Map<number, number>(); // remoteId -> localId

  for (const rc of remoteCategories) {
    const local = await prisma.category.upsert({
      where: { remoteId: rc.id },
      update: { name: rc.name },
      create: { remoteId: rc.id, name: rc.name },
    });
    categoryIdMap.set(rc.id, local.id);
  }

  // Última sincronización exitosa, para pedir solo lo nuevo la próxima vez.
  const lastSync = await prisma.syncLog.findFirst({
    where: { direction: "PULL", status: "SUCCESS" },
    orderBy: { createdAt: "desc" },
  });

  const remoteProducts = await fetchRemoteProducts(lastSync?.createdAt);

  for (const rp of remoteProducts) {
    const localCategoryId = rp.categoryId ? categoryIdMap.get(rp.categoryId) : undefined;

    await prisma.product.upsert({
      where: { remoteId: rp.id },
      update: {
        name: rp.name,
        sku: rp.sku ?? undefined,
        barcode: rp.barcode ?? undefined,
        description: rp.description ?? undefined,
        price: rp.price,
        cost: rp.cost ?? undefined,
        stock: rp.stock,
        unit: rp.unit ?? "unidad",
        active: rp.active,
        categoryId: localCategoryId,
        syncedAt: new Date(),
      },
      create: {
        remoteId: rp.id,
        name: rp.name,
        sku: rp.sku ?? undefined,
        barcode: rp.barcode ?? undefined,
        description: rp.description ?? undefined,
        price: rp.price,
        cost: rp.cost ?? undefined,
        stock: rp.stock,
        unit: rp.unit ?? "unidad",
        active: rp.active,
        categoryId: localCategoryId,
        syncedAt: new Date(),
      },
    });
  }

  await prisma.syncLog.create({
    data: {
      direction: "PULL",
      status: "SUCCESS",
      itemCount: remoteCategories.length + remoteProducts.length,
    },
  });

  return { categories: remoteCategories.length, products: remoteProducts.length };
}
