import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchRemoteFileUrl } from "../sync/admin-client.js";
import { FILE_ID, type ThemeAsset } from "./contract.js";

// Imágenes de marca del tema (logotipo, logotipo oscuro, fondo del acceso). Mismo patrón que las
// imágenes de producto (src/sync/images.ts): se copian a disco para verlas sin conexión y sin
// depender de enlaces firmados que caducan; el archivo se guarda con el id remoto, y como el CRM
// pone otro id al cambiar la imagen, "ya está en disco" equivale a "está al día".

const MAX_BYTES = 3 * 1024 * 1024;
// Un SVG entra porque el frontend lo dibuja SIEMPRE con <img> (allí no ejecuta scripts).
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);

export const THEME_ASSETS_DIR = path.resolve(process.env.POS_THEME_ASSETS_DIR ?? "data/theme-assets");

export interface StoredAsset extends ThemeAsset {
  /** null = todavía no se pudo descargar (se reintenta en el siguiente ciclo). */
  mime: string | null;
}

export function assetPath(fileId: string): string | null {
  // fileId llega de una URL y del tema: se valida para que nunca salga del directorio.
  return FILE_ID.test(fileId) ? path.join(THEME_ASSETS_DIR, fileId) : null;
}

const exists = (file: string): Promise<boolean> => stat(file).then(() => true, () => false);

type FileUrlFetcher = typeof fetchRemoteFileUrl;

// Baja las imágenes que faltan y borra las que el tema ya no usa. `previous` trae las que ya se
// conocían (con su mime) para no volver a pedir lo que ya está en disco. De mejor esfuerzo: una
// imagen que falla queda con `mime: null` y el frontend cae al logotipo POS KIOSKO.
export async function syncThemeAssets(
  wanted: ThemeAsset[],
  previous: StoredAsset[],
  getFileUrl: FileUrlFetcher = fetchRemoteFileUrl,
): Promise<StoredAsset[]> {
  await mkdir(THEME_ASSETS_DIR, { recursive: true });
  const known = new Map(previous.filter((a) => a.mime).map((a) => [a.fileId, a.mime as string]));
  const result: StoredAsset[] = [];

  for (const asset of wanted) {
    const target = assetPath(asset.fileId);
    if (!target) continue;
    const mime = known.get(asset.fileId);
    if (mime && (await exists(target))) {
      result.push({ ...asset, mime });
      continue;
    }
    try {
      const { url, mimeType } = await getFileUrl(asset.fileId);
      if (!ALLOWED_MIME.has(mimeType)) throw new Error(`tipo no permitido (${mimeType})`);
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`descarga ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error("tamaño no permitido");
      await writeFile(target, bytes);
      result.push({ ...asset, mime: mimeType });
    } catch (err) {
      console.error(`[theme] no se pudo bajar la imagen ${asset.fileId}:`, err instanceof Error ? err.message : err);
      result.push({ ...asset, mime: null });
    }
  }

  const keep = new Set(result.map((a) => a.fileId));
  for (const name of await readdir(THEME_ASSETS_DIR).catch(() => [] as string[])) {
    if (!keep.has(name)) await rm(path.join(THEME_ASSETS_DIR, name), { force: true });
  }
  return result;
}

export async function clearThemeAssets(): Promise<void> {
  await rm(THEME_ASSETS_DIR, { recursive: true, force: true });
}
