// Diagnóstico de errores de arranque/conexión con la base de datos local.
//
// POS es una instalación independiente por punto de venta: NO la levanta el
// compose del CRM, sino la persona que la instala en el equipo. Por eso,
// cuando la BD no existe o no es accesible, el mensaje debe decirle a esa
// persona qué hacer (crear la base y aplicar migraciones), no reventar con
// un stacktrace de Prisma.

export interface DbIssue {
  kind: "db_missing" | "db_tables_missing" | "db_unreachable" | "auth_failed" | "other";
  guide: string | null;
}

export function diagnoseDbError(err: unknown): DbIssue {
  const message = err instanceof Error ? err.message : String(err);

  // P1003 / "Database `pos_db` does not exist on the database server ..."
  if (/P1003/.test(message) || /does not exist on the database server/i.test(message)) {
    return {
      kind: "db_missing",
      guide:
        "La base de datos indicada en DATABASE_URL (.env) no existe en el servidor MySQL. " +
        "Créala y aplica las migraciones:\n" +
        "  1) mysql -u root -p -e \"CREATE DATABASE pos_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\"\n" +
        "  2) npx prisma migrate deploy",
    };
  }

  // P2021 / "The table ... does not exist in the current database."
  if (/P2021/.test(message) || /does not exist in the current database/i.test(message)) {
    return {
      kind: "db_tables_missing",
      guide:
        "La base de datos existe pero está vacía (faltan las tablas). " +
        "Aplica las migraciones:\n  npx prisma migrate deploy",
    };
  }

  // P1001 / P1017 / ECONNREFUSED / ENOTFOUND
  if (
    /P1001|P1017/.test(message) ||
    /can.t reach database server/i.test(message) ||
    /ECONNREFUSED/.test(message) ||
    /ENOTFOUND/.test(message)
  ) {
    return {
      kind: "db_unreachable",
      guide:
        "No se pudo conectar al servidor MySQL de DATABASE_URL (.env). " +
        "Verifica que el servidor esté corriendo y que el host/puerto sean correctos.",
    };
  }

  // P1000 / P1010 / "Access denied"
  if (/P1000|P1010/.test(message) || /Access denied/i.test(message)) {
    return {
      kind: "auth_failed",
      guide:
        "MySQL rechazó las credenciales. Revisa el usuario y la contraseña en DATABASE_URL (.env).",
    };
  }

  return { kind: "other", guide: null };
}
