import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

// SQLite (un archivo local; ver DATABASE_URL). Ajustes que dependen del archivo/conexion y no del esquema:
//  - busy_timeout PRIMERO: si otro proceso tiene el archivo un instante (el actualizador corre
//    `prisma migrate deploy`), las sentencias siguientes —incluido el cambio de journal_mode— esperan
//    en vez de fallar con "database is locked".
//  - journal_mode=DELETE (el de SQLite por defecto), NO WAL. Verificado el 2026-10-04: con la base en WAL,
//    `prisma migrate deploy` falla SIEMPRE con "database is locked" mientras el backend este vivo (el
//    schema-engine necesita acceso exclusivo a una base en WAL); con DELETE migra bien con el backend
//    encendido. Eso dejaba a las cajas sin poder actualizarse. Perder WAL no cuesta concurrencia: con
//    connection_limit=1 (pos.env) toda consulta pasa ya por UNA sola conexion. Es persistente: al
//    arrancar convierte solo una base que viniera en WAL de versiones anteriores.
//  - synchronous=FULL (el por defecto): con el diario de reversa, NORMAL puede corromper el archivo si
//    se va la luz a mitad de una escritura; FULL no. Una venta de mostrador no necesita mas velocidad.
// Se llama una vez al arrancar, antes de atender peticiones.
export async function initDatabase(): Promise<void> {
  await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 10000");
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = DELETE");
  await prisma.$queryRawUnsafe("PRAGMA synchronous = FULL");
}
