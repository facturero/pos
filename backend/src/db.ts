import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

// SQLite (un archivo local; ver DATABASE_URL). Ajustes que dependen del archivo/conexion y no del esquema:
//  - WAL: las lecturas (pantalla, catalogo) no esperan a las escrituras (ventas, sincronizacion) y una
//    caida de luz a mitad de escritura no corrompe el archivo. Es persistente: queda en el archivo.
//  - synchronous=NORMAL: con WAL es seguro ante caidas del proceso; solo una caida de luz puede perder
//    la ultima transaccion (no corromperla). Evita un fsync por cada venta.
//  - busy_timeout: si otro proceso (el actualizador corre `prisma migrate deploy`) tiene el archivo
//    bloqueado un instante, se espera en vez de fallar con "database is locked".
// Se llama una vez al arrancar, antes de atender peticiones.
export async function initDatabase(): Promise<void> {
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL");
  await prisma.$queryRawUnsafe("PRAGMA synchronous = NORMAL");
  await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 10000");
}
