// Convierte `run` en una función que NUNCA se solapa consigo misma y NUNCA pierde un aviso: si la llaman
// mientras ya está corriendo, no arranca otra en paralelo, pero deja anotado que hace falta repetir y, al
// terminar, corre UNA vez más (aunque la hayan llamado cien veces mientras tanto).
//
// Motivo (visto el 2026-10-05): el planificador de sync hacía `if (isSyncing) return;`, así que un aviso del
// CRM ("catalog.changed") que llegaba con un ciclo ya en marcha se tiraba. Al crear 5 productos casi a la
// vez, el primer aviso arrancaba el ciclo, los otros 4 se descartaban, y el ciclo —que ya había leído el
// catálogo— no veía el último producto hasta el ciclo programado, 5 minutos después.
export function coalesced(run: () => Promise<void>): () => Promise<void> {
  let running = false;
  let again = false;
  return async function trigger(): Promise<void> {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await run();
      } while (again);
    } finally {
      running = false;
    }
  };
}
