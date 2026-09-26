import { readFileSync } from "node:fs";

// Versión de la instalación (archivo VERSION junto al dist, lo genera el release). El actualizador la usa para
// decidir si la versión que bajó es la que realmente quedó activa, y la barra inferior de la pantalla la muestra.
// En desarrollo no existe el archivo: sin versión.
function readVersion(): string | undefined {
  try {
    const value = readFileSync(new URL("./VERSION", import.meta.url), "utf8").trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export const version = readVersion();
