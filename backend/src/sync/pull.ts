import { prisma } from "../db.js";
import {
  fetchRemoteCategories,
  fetchRemoteCustomerDetail,
  fetchRemoteCustomers,
  fetchRemoteProducts,
  fetchRemoteTaxRates,
  fetchRemoteUsers,
  getCountryCode,
  type RemoteProduct,
} from "./admin-client.js";
import { staleRemoteIds } from "./stale.js";
import { syncTheme } from "../theme/service.js";

// Baja del admin y deja espejados localmente (por `remoteId`, uuid):
// categorías, productos, usuarios y clientes (con contactos y direcciones).
// Es un upsert: si ya existe localmente (por remoteId) lo actualiza, si no lo
// crea. Lo que el admin ya no devuelve NO se borra si algo local lo referencia (productos y clientes
// quedan en las ventas ya hechas): se desactiva. Solo se borra lo que nadie referencia: categorías,
// contactos y direcciones. Todo esto solo ocurre tras una descarga completa (request() lanza ante
// cualquier error), nunca con una respuesta a medias.
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

  // El tema visual va aparte y NO cuenta como fuente de datos: si falla, la caja se queda con la
  // copia anterior y la venta sigue igual (el aspecto nunca puede bloquear el cobro).
  try {
    await syncTheme();
  } catch (err) {
    errors.push(`tema: ${message(err)}`);
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

  // Categorías borradas en el CRM: se quitan ANTES del upsert. `name` es único, así que una categoría
  // borrada y vuelta a crear con el mismo nombre (otro uuid) chocaría con la vieja y tiraría el sync entero.
  // Sus productos quedan sin categoría hasta que el bucle de productos les asigne la que corresponda.
  const localCategories = await prisma.category.findMany({
    where: { remoteId: { not: null } },
    select: { id: true, remoteId: true },
  });
  const goneCategories = new Set(
    staleRemoteIds(
      localCategories.map((c) => c.remoteId as string),
      remoteCategories.map((c) => c.id),
    ),
  );
  const goneCategoryIds = localCategories.filter((c) => goneCategories.has(c.remoteId as string)).map((c) => c.id);
  if (goneCategoryIds.length > 0) {
    await prisma.product.updateMany({ where: { categoryId: { in: goneCategoryIds } }, data: { categoryId: null } });
    await prisma.category.deleteMany({ where: { id: { in: goneCategoryIds } } });
    console.log(`[sync] ${goneCategoryIds.length} categoría(s) borrada(s) en el CRM: se quitan de la caja`);
  }

  for (const rc of remoteCategories) {
    const local = await prisma.category.upsert({
      where: { remoteId: rc.id },
      update: { name: rc.name },
      create: { remoteId: rc.id, name: rc.name },
    });
    categoryIdMap.set(rc.id, local.id);
  }

  const remoteProducts = await fetchRemoteProducts(establishmentId);

  // Las tasas se bajan UNA vez y se resuelven por producto: el IVA es individual de cada
  // producto (cada uno referencia su tasa por id). Si esta llamada falla, se corta la
  // sincronización de productos entera: es preferible conservar el catálogo anterior, con
  // sus impuestos correctos, que guardar productos con impuestos inventados.
  const countryCode = await getCountryCode();
  const rateById = new Map((await fetchRemoteTaxRates(countryCode)).map((r) => [r.id, r]));

  for (const rp of remoteProducts) {
    // Sin categoría en el CRM => null (se limpia la que tuviera). Con una categoría que no llegó en la lista
    // => undefined (no se toca): no se pierde un dato por una respuesta inconsistente.
    const localCategoryId = rp.categoryId ? categoryIdMap.get(rp.categoryId) : null;
    const taxes = resolveProductTaxes(rp, rateById);

    await prisma.product.upsert({
      where: { remoteId: rp.id },
      update: {
        name: rp.name,
        sku: rp.sku ?? undefined,
        price: rp.price,
        currencyCode: rp.currencyCode,
        active: rp.status === "active",
        categoryId: localCategoryId,
        priceIncludesTax: rp.priceIncludesTax,
        imageFileId: rp.imageFileId,
        ...(taxes !== undefined ? { taxes } : {}),
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
        priceIncludesTax: rp.priceIncludesTax,
        imageFileId: rp.imageFileId,
        ...(taxes !== undefined ? { taxes } : {}),
        syncedAt: new Date(),
      },
    });
  }

  // Lo que el CRM ya no lista (desactivado, o quitado del establecimiento de esta caja) se desactiva aquí:
  // la lista se pide con status=active, así que esos productos NO llegan como "inactivos", solo desaparecen.
  // Se desactivan y no se borran: las ventas ya hechas siguen apuntando a ellos. Esta línea solo se alcanza
  // si la descarga salió bien (request() lanza ante cualquier error), nunca con una respuesta a medias.
  const localActive = await prisma.product.findMany({
    where: { active: true, remoteId: { not: null } },
    select: { remoteId: true },
  });
  const stale = staleRemoteIds(
    localActive.map((p) => p.remoteId as string),
    remoteProducts.map((p) => p.id),
  );
  for (let i = 0; i < stale.length; i += 500) {
    await prisma.product.updateMany({
      where: { remoteId: { in: stale.slice(i, i + 500) } },
      data: { active: false, syncedAt: new Date() },
    });
  }
  if (stale.length > 0) console.log(`[sync] ${stale.length} producto(s) desactivado(s) en el CRM: se quitan de la caja`);

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

  // Un usuario QUITADO de este establecimiento en el CRM no llega como "inactivo": la lista se pide filtrada por
  // establecimiento, así que simplemente deja de aparecer, y sin esto seguía pudiendo entrar a esta caja. Se
  // desactiva (no se borra: sus ventas apuntan a él). Si la lista llega vacía no se toca a nadie: preferible
  // no cerrar el acceso a todos por una respuesta rara que dejar uno de más hasta el siguiente ciclo.
  if (remoteUsers.length > 0) {
    const localActive = await prisma.user.findMany({
      where: { active: true, remoteId: { not: null } },
      select: { remoteId: true },
    });
    const gone = staleRemoteIds(
      localActive.map((u) => u.remoteId as string),
      remoteUsers.map((u) => u.id),
    );
    if (gone.length > 0) {
      await prisma.user.updateMany({ where: { remoteId: { in: gone } }, data: { active: false } });
      console.log(`[sync] ${gone.length} usuario(s) ya no son de este establecimiento: se desactivan en la caja`);
    }
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

      const keepContacts = detail.contacts.map((c) => c.id);
      const localContacts = await prisma.customerContact.findMany({
        where: { customerId: local.id, remoteId: { not: null } },
        select: { remoteId: true },
      });
      const goneContacts = staleRemoteIds(localContacts.map((c) => c.remoteId as string), keepContacts);
      if (goneContacts.length > 0) {
        await prisma.customerContact.deleteMany({ where: { remoteId: { in: goneContacts } } });
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

      const localAddresses = await prisma.customerAddress.findMany({
        where: { customerId: local.id, remoteId: { not: null } },
        select: { remoteId: true },
      });
      const goneAddresses = staleRemoteIds(
        localAddresses.map((x) => x.remoteId as string),
        detail.addresses.map((x) => x.id),
      );
      if (goneAddresses.length > 0) {
        await prisma.customerAddress.deleteMany({ where: { remoteId: { in: goneAddresses } } });
      }
    } catch (err) {
      console.warn(`[sync] detalle del cliente ${rc.id} no disponible: ${message(err)}`);
    }
  }

  return remoteCustomers.length;
}

// Impuestos del producto con su porcentaje resuelto: [{ taxRateId, kind, percentage }].
// `undefined` = el CRM no mandó `taxes` (versión anterior): se deja lo que ya hubiera
// guardado, y un producto sin datos de impuestos no se puede cobrar (ver sales.routes.ts).
// Una tasa que ya no aparece en tax-service se trata como 0%, igual que billing (que la
// factura con 0 en ese caso), y se avisa en el log.
function resolveProductTaxes(
  rp: RemoteProduct,
  rateById: Map<string, { percentage: string | number }>,
): { taxRateId: string; kind: string; percentage: number }[] | undefined {
  if (rp.taxes === undefined) return undefined;
  return rp.taxes.map((t) => {
    const rate = rateById.get(t.taxRateId);
    if (!rate) {
      console.warn(`[sync] producto ${rp.id}: la tasa ${t.taxRateId} no existe en tax-service; se usa 0%`);
    }
    return { taxRateId: t.taxRateId, kind: t.kind, percentage: rate ? parseFloat(String(rate.percentage)) : 0 };
  });
}
