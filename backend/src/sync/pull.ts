import { prisma } from "../db.js";
import {
  fetchRemoteCategories,
  fetchRemoteCustomerDetail,
  fetchRemoteCustomers,
  fetchRemoteProducts,
  fetchRemoteUsers,
} from "./admin-client.js";

// Baja del admin y deja espejados localmente (por `remoteId`, uuid):
// categorías, productos, usuarios y clientes (con contactos y direcciones).
// Es un upsert: si ya existe localmente (por remoteId) lo actualiza, si no lo
// crea. Nunca borra localmente aunque desaparezcan del admin — más seguro
// ante errores parciales de red.
//
// Cada sección se ejecuta en su propio try/catch: si un servicio del admin
// está caído (p.ej. customer-service), los demás siguen sincronizando y el
// syncLog registra SUCCESS solo si al menos una fuente pudo bajar datos.

interface PullCounts {
  categories: number;
  products: number;
  users: number;
  customers: number;
}

export async function pullFromAdmin(): Promise<PullCounts> {
  const counts: PullCounts = { categories: 0, products: 0, users: 0, customers: 0 };
  const errors: string[] = [];
  let succeeded = 0;

  try {
    const { categories, products } = await syncCategoriesAndProducts();
    counts.categories = categories;
    counts.products = products;
    succeeded++;
  } catch (err) {
    errors.push(`catálogo: ${message(err)}`);
  }

  try {
    counts.users = await syncUsers();
    succeeded++;
  } catch (err) {
    errors.push(`usuarios: ${message(err)}`);
  }

  try {
    counts.customers = await syncCustomers();
    succeeded++;
  } catch (err) {
    errors.push(`clientes: ${message(err)}`);
  }

  if (succeeded === 0) {
    throw new Error(`El pull falló en todas las fuentes: ${errors.join(" | ")}`);
  }

  const itemCount =
    counts.categories + counts.products + counts.users + counts.customers;

  await prisma.syncLog.create({
    data: {
      direction: "PULL",
      status: "SUCCESS",
      itemCount,
      message: errors.length ? `Fuentes fallidas: ${errors.join(" | ")}` : null,
    },
  });

  return counts;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Categorías + productos juntos: se baja la lista de categorías una sola vez
// y se arma el mapa remoteId -> id local para asignar la categoría a cada
// producto. Los productos se filtran por el ESTABLECIMIENTO del punto de
// emisión emparejado (pos_config): este POS solo espeja su catálogo.
async function syncCategoriesAndProducts(): Promise<{
  categories: number;
  products: number;
}> {
  const posConfig = await prisma.posConfig.findUnique({ where: { id: 1 } });
  const establishmentId = posConfig?.establishmentId ?? undefined;

  const remoteCategories = await fetchRemoteCategories();

  const categoryIdMap = new Map<string, number>(); // remoteId (uuid) -> id local

  for (const rc of remoteCategories) {
    const local = await prisma.category.upsert({
      where: { remoteId: rc.id },
      update: { name: rc.name },
      create: { remoteId: rc.id, name: rc.name },
    });
    categoryIdMap.set(rc.id, local.id);
  }

  const remoteProducts = await fetchRemoteProducts(establishmentId);

  for (const rp of remoteProducts) {
    const localCategoryId = rp.categoryId ? categoryIdMap.get(rp.categoryId) : undefined;

    await prisma.product.upsert({
      where: { remoteId: rp.id },
      update: {
        name: rp.name,
        sku: rp.sku ?? undefined,
        price: rp.price,
        currencyCode: rp.currencyCode,
        active: rp.status === "active",
        categoryId: localCategoryId,
        syncedAt: new Date(),
      },
      create: {
        remoteId: rp.id,
        name: rp.name,
        sku: rp.sku ?? undefined,
        price: rp.price,
        currencyCode: rp.currencyCode,
        active: rp.status === "active",
        categoryId: localCategoryId,
        syncedAt: new Date(),
      },
    });
  }

  return { categories: remoteCategories.length, products: remoteProducts.length };
}

async function syncUsers(): Promise<number> {
  const posConfig = await prisma.posConfig.findUnique({ where: { id: 1 } });
  const establishmentId = posConfig?.establishmentId ?? undefined;
  const remoteUsers = await fetchRemoteUsers(establishmentId);

  for (const ru of remoteUsers) {
    // El nombre de usuario con el que el cajero hace login en el POS es el
    // código de 7 caracteres que genera auth-service. Si por cualquier razón
    // el remoto no lo trae todavía (p.ej. usuario viejo), se cae al email.
    const username = ru.username ?? ru.email ?? `user-${ru.id}`;
    const email = ru.email || null;
    const role = ru.roles.includes("Administrador") ? "ADMIN" : "CASHIER";

    await prisma.user
      .upsert({
        where: { remoteId: ru.id },
        update: {
          name: ru.fullName ?? email ?? username,
          username,
          email,
          role,
          active: ru.status === "active",
          // Se baja el hash del CRM (argon2id) para que el login valide
          // localmente, sin internet. Se pasa tal cual (string | null):
          // si un admin viejo todavía no manda el campo, Prisma lo ignora y
          // no se toca el hash ya vinculado.
          passwordHash: ru.passwordHash,
        },
        create: {
          remoteId: ru.id,
          name: ru.fullName ?? email ?? username,
          username,
          email,
          role,
          active: ru.status === "active",
          passwordHash: ru.passwordHash ?? null,
        },
      })
      .catch((err) => {
        // Posible choque de `username` con un usuario local existente (p.ej.
        // un cajero creado en el POS con ese mismo código/email): no rompemos
        // el pull, el usuario remoto se reintentará en el próximo ciclo.
        console.warn(`[sync] usuario ${username} no se pudo sincronizar: ${message(err)}`);
      });
  }

  return remoteUsers.length;
}

async function syncCustomers(): Promise<number> {
  const remoteCustomers = await fetchRemoteCustomers();

  for (const rc of remoteCustomers) {
    const local = await prisma.customer.upsert({
      where: { remoteId: rc.id },
      update: {
        countryCode: rc.countryCode,
        identificationTypeId: rc.identificationTypeId,
        identification: rc.identification,
        businessName: rc.businessName,
        tradeName: rc.tradeName,
        email: rc.email,
        phone: rc.phone,
        type: rc.type === "company" ? "COMPANY" : "PERSON",
        status: rc.status === "active" ? "ACTIVE" : "INACTIVE",
        syncedAt: new Date(),
      },
      create: {
        remoteId: rc.id,
        countryCode: rc.countryCode,
        identificationTypeId: rc.identificationTypeId,
        identification: rc.identification,
        businessName: rc.businessName,
        tradeName: rc.tradeName,
        email: rc.email,
        phone: rc.phone,
        type: rc.type === "company" ? "COMPANY" : "PERSON",
        status: rc.status === "active" ? "ACTIVE" : "INACTIVE",
        syncedAt: new Date(),
      },
    });

    // Contactos y direcciones vienen en el detalle; si el detalle falla no
    // tiramos abajo la sincronización del cliente (queda el read-model plano).
    try {
      const detail = await fetchRemoteCustomerDetail(rc.id);

      for (const c of detail.contacts) {
        await prisma.customerContact.upsert({
          where: { remoteId: c.id },
          update: { name: c.name, email: c.email, phone: c.phone, position: c.position },
          create: {
            remoteId: c.id,
            customerId: local.id,
            name: c.name,
            email: c.email,
            phone: c.phone,
            position: c.position,
          },
        });
      }

      for (const a of detail.addresses) {
        await prisma.customerAddress.upsert({
          where: { remoteId: a.id },
          update: {
            type: a.type.toUpperCase() as "BILLING" | "SHIPPING" | "OTHER",
            line1: a.line1,
            line2: a.line2,
            city: a.city,
            province: a.province,
            countryCode: a.countryCode,
            postalCode: a.postalCode,
            isPrimary: a.isPrimary,
          },
          create: {
            remoteId: a.id,
            customerId: local.id,
            type: a.type.toUpperCase() as "BILLING" | "SHIPPING" | "OTHER",
            line1: a.line1,
            line2: a.line2,
            city: a.city,
            province: a.province,
            countryCode: a.countryCode,
            postalCode: a.postalCode,
            isPrimary: a.isPrimary,
          },
        });
      }
    } catch (err) {
      console.warn(`[sync] detalle del cliente ${rc.id} no disponible: ${message(err)}`);
    }
  }

  return remoteCustomers.length;
}
