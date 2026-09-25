import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db.js";
import { fetchRemoteFileUrl } from "./admin-client.js";

// Las imágenes de producto viven en document-service (MinIO). El POS las copia a disco para
// verlas sin conexión y sin depender de enlaces firmados que caducan. El archivo se guarda
// con el id del archivo remoto: cuando el CRM cambia la imagen de un producto le pone otro
// id, así que "ya está en disco" equivale a "está al día" y nunca hay que revalidar.

const MAX_BYTES = 5 * 1024 * 1024;
const CONCURRENCY = 4;
const FILE_ID = /^[0-9a-zA-Z-]{8,64}$/;

export const IMAGES_DIR = path.resolve(process.env.POS_IMAGES_DIR ?? "data/product-images");

export function imagePath(fileId: string): string | null {
  // fileId llega de la URL: se valida para que nunca salga del directorio de imágenes.
  return FILE_ID.test(fileId) ? path.join(IMAGES_DIR, fileId) : null;
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(() => true, () => false);
}

type FileUrlFetcher = typeof fetchRemoteFileUrl;

async function downloadOne(fileId: string, getFileUrl: FileUrlFetcher): Promise<void> {
  const target = imagePath(fileId);
  if (!target) return;
  const { url, mimeType } = await getFileUrl(fileId);
  if (!mimeType.startsWith("image/")) return;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`descarga ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return;
  await writeFile(target, bytes);
  await prisma.product.updateMany({ where: { imageFileId: fileId }, data: { imageMime: mimeType } });
}

let running = false;

// Baja las imágenes que faltan y borra las que ya ningún producto usa. Es de "mejor esfuerzo":
// una imagen que falla no rompe nada (el producto se ve sin foto) y se reintenta en el
// siguiente ciclo. Va aparte del pull para que las descargas no retrasen el envío de ventas.
// getFileUrl se puede sustituir (pruebas sin document-service).
export async function syncProductImages(getFileUrl: FileUrlFetcher = fetchRemoteFileUrl): Promise<{ downloaded: number; failed: number }> {
  if (running) return { downloaded: 0, failed: 0 };
  running = true;
  let downloaded = 0;
  let failed = 0;
  try {
    await mkdir(IMAGES_DIR, { recursive: true });
    const products = await prisma.product.findMany({
      where: { imageFileId: { not: null } },
      select: { imageFileId: true, imageMime: true },
    });
    const wanted = new Set<string>();
    const missing: string[] = [];
    for (const p of products) {
      const id = p.imageFileId!;
      const file = imagePath(id);
      if (!file) continue;
      wanted.add(id);
      // Sin imageMime la descarga anterior no terminó: se repite.
      if (!p.imageMime || !(await exists(file))) missing.push(id);
    }

    const queue = [...new Set(missing)];
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (let id = queue.pop(); id; id = queue.pop()) {
          try {
            await downloadOne(id, getFileUrl);
            downloaded++;
          } catch (err) {
            failed++;
            console.warn(`[images] no se pudo bajar ${id}: ${err instanceof Error ? err.message : err}`);
          }
        }
      }),
    );

    // Limpieza: imágenes que ya ningún producto referencia (cambiadas o quitadas en el CRM).
    for (const name of await readdir(IMAGES_DIR)) {
      if (!wanted.has(name)) await rm(path.join(IMAGES_DIR, name), { force: true });
    }
  } finally {
    running = false;
  }
  return { downloaded, failed };
}
