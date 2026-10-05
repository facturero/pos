-- AlterTable
-- Permisos del usuario en el CRM (JSON: ["invoice:create", ...]), la union de los de sus roles. NULL = no se sabe
-- (usuario local o aun sin sincronizar): se conserva el comportamiento anterior.
ALTER TABLE "users" ADD COLUMN "permissions" TEXT;
