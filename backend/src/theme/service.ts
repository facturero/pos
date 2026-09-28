import { prisma } from "../db.js";
import { fetchRemoteTheme, type RemoteTheme } from "../sync/admin-client.js";
import { emitThemeChanged } from "../local/socket.js";
import { clearThemeAssets, syncThemeAssets, type StoredAsset } from "./assets.js";
import { sanitizeTheme, themeAssets, type ThemeConfig } from "./contract.js";

// Lo que se guarda de un tema del CRM. Pura (sin red ni base de datos) para poder probarla:
// el CRM puede mandar "usa el integrado" (config null) o un tema; en el segundo caso se
// SANEA antes de guardar, así lo que hay en disco ya es siempre un tema válido.
export interface ThemeRecord {
  themeId: string | null;
  name: string | null;
  source: string;
  version: number;
  etag: string | null;
  config: ThemeConfig | null;
}

export function buildThemeRecord(remote: RemoteTheme): ThemeRecord {
  const builtin = remote.config === null || remote.config === undefined;
  return {
    themeId: builtin ? null : remote.themeId,
    name: builtin ? null : remote.name,
    source: remote.source === "point" || remote.source === "default" ? remote.source : "builtin",
    version: Number.isInteger(remote.version) ? remote.version : 0,
    etag: typeof remote.etag === "string" ? remote.etag : null,
    config: builtin ? null : sanitizeTheme(remote.config),
  };
}

function parseAssets(json: string): StoredAsset[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as StoredAsset[]) : [];
  } catch {
    return [];
  }
}

// Pide el tema de ESTE punto al CRM y lo deja guardado. Se llama desde el ciclo de
// sincronización y cuando el hub avisa `pos.theme.changed`. Nunca lanza por un tema malo:
// solo por errores de red/CRM, que el llamador registra (la caja se queda con la copia anterior).
export async function syncTheme(): Promise<{ changed: boolean }> {
  const config = await prisma.posConfig.findUnique({ where: { id: 1 } });
  if (!config) return { changed: false };

  const current = await prisma.posTheme.findUnique({ where: { id: 1 } });
  const result = await fetchRemoteTheme(config.establishmentId, config.emissionPointId, current?.etag);
  if (result.status === "unavailable") return { changed: false };

  if (result.status === "not-modified") {
    // Sin cambios de tema, pero alguna imagen pudo quedar sin bajar (sin red en su momento).
    const assets = parseAssets(current?.assetsJson ?? "[]");
    if (!current || !assets.some((a) => !a.mime)) return { changed: false };
    const refreshed = await syncThemeAssets(assets.map(({ role, fileId }) => ({ role, fileId })), assets);
    await prisma.posTheme.update({ where: { id: 1 }, data: { assetsJson: JSON.stringify(refreshed) } });
    emitThemeChanged();
    return { changed: true };
  }

  const record = buildThemeRecord(result.theme);
  const wanted = record.config ? themeAssets(record.config) : [];
  const assets = await syncThemeAssets(wanted, parseAssets(current?.assetsJson ?? "[]"));
  const data = {
    themeId: record.themeId,
    name: record.name,
    source: record.source,
    version: record.version,
    etag: record.etag,
    configJson: record.config ? JSON.stringify(record.config) : null,
    assetsJson: JSON.stringify(assets),
    fetchedAt: new Date(),
  };
  await prisma.posTheme.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
  console.log(`[theme] tema actualizado: ${record.name ?? "integrado"} (v${record.version}, ${record.source})`);
  emitThemeChanged();
  return { changed: true };
}

export interface CurrentTheme {
  source: string;
  name: string | null;
  version: number;
  /** null = usa el tema integrado (el frontend lo trae de fábrica). */
  config: ThemeConfig | null;
  /** Solo las imágenes ya descargadas, con la URL local para mostrarlas. */
  assets: { role: string; url: string }[];
}

export async function getCurrentTheme(): Promise<CurrentTheme> {
  const row = await prisma.posTheme.findUnique({ where: { id: 1 } });
  if (!row?.configJson) return { source: "builtin", name: null, version: row?.version ?? 0, config: null, assets: [] };
  let config: ThemeConfig;
  try {
    // Se vuelve a sanear al leer: si una versión futura de esta caja cambió el contrato, o el
    // archivo se tocó a mano, la pantalla nunca recibe algo que no entienda.
    config = sanitizeTheme(JSON.parse(row.configJson));
  } catch {
    return { source: "builtin", name: null, version: row.version, config: null, assets: [] };
  }
  const assets = parseAssets(row.assetsJson)
    .filter((a) => a.mime)
    .map((a) => ({ role: a.role, url: `/theme/assets/${a.fileId}` }));
  return { source: row.source, name: row.name, version: row.version, config, assets };
}

// Al desvincular (a mano o desde el CRM): una caja reasignada no debe heredar la marca anterior.
export async function clearTheme(): Promise<void> {
  await prisma.posTheme.deleteMany({ where: { id: 1 } });
  await clearThemeAssets();
  emitThemeChanged();
}
