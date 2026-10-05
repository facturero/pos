// Productos que el POS tiene activos pero que el CRM ya no devuelve. El POS pide la lista con
// `?status=active&establishmentId=…`, así que un producto DESACTIVADO en el CRM —o quitado del
// establecimiento de esta caja— no llega como "inactivo": simplemente deja de aparecer. Sin este cálculo la
// caja lo conservaba activo para siempre y se podía seguir cobrando (visto el 2026-10-05: 5 productos
// desactivados en el CRM seguían vendiéndose en la caja de pruebas).
export function staleRemoteIds(localActiveRemoteIds: string[], remoteIds: string[]): string[] {
  const alive = new Set(remoteIds);
  return localActiveRemoteIds.filter((id) => !alive.has(id));
}
