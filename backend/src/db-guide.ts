// Diagnóstico de errores de arranque/conexión con la base de datos local (SQLite: un archivo).
//
// POS es una instalación independiente por punto de venta. Cuando la base no existe o no es accesible,
// el mensaje debe decirle a quien la instala qué hacer (aplicar migraciones, revisar permisos), no reventar
// con un stacktrace de Prisma.

export interface DbIssue {
  kind: "db_missing" | "db_tables_missing" | "db_unreachable" | "auth_failed" | "other";
  guide: string | null;
}

export function diagnoseDbError(err: unknown): DbIssue {
  const message = err instanceof Error ? err.message : String(err);

  // P2021 / "The table ... does not exist in the current database." (archivo nuevo o vacío)
  if (/P2021/.test(message) || /does not exist in the current database/i.test(message) || /no such table/i.test(message)) {
    return {
      kind: "db_tables_missing",
      guide:
        "La base de datos existe pero está vacía (faltan las tablas). " +
        "Aplica las migraciones:\n  npx prisma migrate deploy",
    };
  }

  // P1003 / el archivo no existe
  if (/P1003/.test(message) || /Database .* does not exist/i.test(message)) {
    return {
      kind: "db_missing",
      guide:
        "El archivo de la base de datos indicado en DATABASE_URL (.env) no existe. " +
        "`npx prisma migrate deploy` lo crea (la carpeta debe existir y ser escribible).",
    };
  }

  // No se puede abrir el archivo (carpeta inexistente, ruta mal escrita)
  if (/P1001|P1017/.test(message) || /unable to open database file/i.test(message) || /Error code 14/i.test(message)) {
    return {
      kind: "db_unreachable",
      guide:
        "No se pudo abrir el archivo de la base de datos de DATABASE_URL (.env). " +
        "Verifica que la ruta sea correcta y que la carpeta exista.",
    };
  }

  // Permisos: el usuario del servicio no puede escribir el archivo o su carpeta (WAL crea archivos junto a él)
  if (/readonly database/i.test(message) || /P1010/.test(message) || /permission denied/i.test(message) || /EACCES/.test(message)) {
    return {
      kind: "auth_failed",
      guide:
        "El usuario que ejecuta el POS no puede escribir la base de datos (ni su carpeta). " +
        "Revisa el propietario y los permisos del archivo y de su directorio.",
    };
  }

  return { kind: "other", guide: null };
}
