// Permisos del POS. El CRM da permisos a ROLES y los roles a usuarios; la caja decide por PERMISO, nunca por el
// nombre de un rol: un rol nuevo, o uno al que le quiten o pongan permisos, funciona sin tocar la caja.
//
// Este archivo es la declaración de los permisos que el POS entiende. El CRM necesita además la fila en su catálogo
// (auth-service, migración `add-pos-access-permission`) para poder asignarlo a roles desde su editor.
export const POS_ACCESS_PERMISSION = "pos:access";

export interface RoleWithPermissions {
  name: string;
  permissions: string[];
}

// Unión de los permisos de los roles del usuario. Un rol que no aparece en la lista (renombrado, o la lista vino
// incompleta) no aporta nada: se prefiere quitar un permiso de más que dar uno que el CRM no concedió.
export function permissionsForRoles(roleNames: string[], roles: RoleWithPermissions[]): string[] {
  const byName = new Map(roles.map((r) => [r.name, r.permissions]));
  const granted = new Set<string>();
  for (const name of roleNames) {
    for (const permission of byName.get(name) ?? []) granted.add(permission);
  }
  return [...granted].sort();
}

// Qué guardar en `users.permissions` en cada sincronización.
//  - `catalogHasPosAccess`: ¿conoce el CRM el permiso `pos:access`? true/false; null si no se pudo consultar.
//  - `fromUser`: los permisos que el CRM manda con el usuario (GET /users); undefined si el CRM aún no los manda.
//  - `fromRoles`: lo calculado con GET /roles, de respaldo; undefined si esa llamada falló.
// Resultado: texto JSON = estos son sus permisos; null = "no se sabe, se conserva el comportamiento de siempre
// (entra)"; undefined = no tocar lo que ya hay.
export function permissionsToStore(args: {
  catalogHasPosAccess: boolean | null;
  fromUser: string[] | undefined;
  fromRoles: string[] | undefined;
}): string | null | undefined {
  // Un CRM que todavía no tiene el permiso en su catálogo (se despliega aparte de la caja) NO puede dejar a todo el
  // mundo fuera: mientras no exista, nadie tiene que tenerlo.
  if (args.catalogHasPosAccess === false) return null;
  if (args.catalogHasPosAccess === null) return undefined;
  const permissions = args.fromUser ?? args.fromRoles;
  return permissions === undefined ? undefined : JSON.stringify([...new Set(permissions)].sort());
}

// ¿Puede este usuario entrar a la caja? `null`/`undefined` = no se sabe (usuario creado en la caja, o una caja
// recién actualizada que aún no sincronizó): se conserva lo de siempre, entra. Un valor ilegible NO es "no se sabe":
// se niega.
export function hasPosAccess(permissionsJson: string | null | undefined): boolean {
  if (permissionsJson === null || permissionsJson === undefined) return true;
  try {
    const list: unknown = JSON.parse(permissionsJson);
    return Array.isArray(list) && list.includes(POS_ACCESS_PERMISSION);
  } catch {
    return false;
  }
}
