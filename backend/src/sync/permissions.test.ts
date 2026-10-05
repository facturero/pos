import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasPosAccess, permissionsForRoles, permissionsToStore, POS_ACCESS_PERMISSION } from "./permissions.js";

const ROLES = [
  { name: "Administrador", permissions: ["invoice:read", POS_ACCESS_PERMISSION] },
  { name: "Vendedor", permissions: ["invoice:read", POS_ACCESS_PERMISSION] },
  { name: "Solo lectura", permissions: ["invoice:read"] },
  { name: "Contador", permissions: ["invoice:read"] },
];
const stored = (roles: string[]) =>
  permissionsToStore({ catalogHasPosAccess: true, fromUser: undefined, fromRoles: permissionsForRoles(roles, ROLES) });

describe("acceso al POS por permiso", () => {
  it("entra quien tiene pos:access; no entra quien no lo tiene", () => {
    assert.equal(hasPosAccess(stored(["Vendedor"])), true);
    assert.equal(hasPosAccess(stored(["Administrador"])), true);
    assert.equal(hasPosAccess(stored(["Solo lectura"])), false);
    assert.equal(hasPosAccess(stored(["Contador"])), false);
  });

  it("varios roles suman: Solo lectura + Vendedor entra", () => {
    assert.equal(hasPosAccess(stored(["Solo lectura", "Vendedor"])), true);
  });

  it("sin roles o con un rol desconocido no hay permiso", () => {
    assert.equal(hasPosAccess(stored([])), false);
    assert.equal(hasPosAccess(stored(["Rol que ya no existe"])), false);
  });

  it("decide el PERMISO, no el nombre: un rol personalizado con pos:access entra", () => {
    const roles = [...ROLES, { name: "Cajero nocturno", permissions: [POS_ACCESS_PERMISSION] }];
    const json = permissionsToStore({ catalogHasPosAccess: true, fromUser: undefined, fromRoles: permissionsForRoles(["Cajero nocturno"], roles) });
    assert.equal(hasPosAccess(json), true);
  });

  it("el permiso que el CRM manda con el usuario manda sobre lo calculado con los roles", () => {
    const json = permissionsToStore({ catalogHasPosAccess: true, fromUser: ["invoice:read"], fromRoles: [POS_ACCESS_PERMISSION] });
    assert.equal(hasPosAccess(json), false);
    const json2 = permissionsToStore({ catalogHasPosAccess: true, fromUser: [POS_ACCESS_PERMISSION], fromRoles: undefined });
    assert.equal(hasPosAccess(json2), true);
  });

  it("si el CRM aún no conoce pos:access en su catálogo, nadie queda fuera", () => {
    const json = permissionsToStore({ catalogHasPosAccess: false, fromUser: ["invoice:read"], fromRoles: undefined });
    assert.equal(json, null);
    assert.equal(hasPosAccess(json), true);
  });

  it("si no se pudo consultar el catálogo o los permisos, no se toca lo que había", () => {
    assert.equal(permissionsToStore({ catalogHasPosAccess: null, fromUser: [POS_ACCESS_PERMISSION], fromRoles: undefined }), undefined);
    assert.equal(permissionsToStore({ catalogHasPosAccess: true, fromUser: undefined, fromRoles: undefined }), undefined);
  });

  it("sin dato (null/undefined, usuario local o sin sincronizar) entra como siempre", () => {
    assert.equal(hasPosAccess(null), true);
    assert.equal(hasPosAccess(undefined), true);
  });

  it("un valor guardado que no se puede leer se NIEGA", () => {
    assert.equal(hasPosAccess("{no es json"), false);
    assert.equal(hasPosAccess(JSON.stringify({ pos: true })), false);
  });

  it("los permisos se guardan ordenados y sin repetir", () => {
    const json = permissionsToStore({ catalogHasPosAccess: true, fromUser: ["b", "a", "b"], fromRoles: undefined });
    assert.equal(json, JSON.stringify(["a", "b"]));
  });
});
