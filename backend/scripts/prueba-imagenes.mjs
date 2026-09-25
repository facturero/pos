// Prueba de las imágenes de producto SIN document-service: levanta un servidor falso que hace de
// almacenamiento, le asigna una imagen a un producto de la base local, corre syncProductImages y
// comprueba el archivo en disco y la ruta /product-images. Al terminar deja el producto como estaba.
// Uso: npx tsx scripts/prueba-imagenes.mjs   (con el backend del POS corriendo en :4000)
import http from "node:http";
import { existsSync } from "node:fs";
import { prisma } from "../src/db.ts";
import { syncProductImages, imagePath } from "../src/sync/images.ts";

// PNG de 1x1 px
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const server = http.createServer((_req, res) => { res.writeHead(200, { "Content-Type": "image/png" }); res.end(PNG); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const storage = `http://127.0.0.1:${server.address().port}/img`;

const product = await prisma.product.findFirst({ where: { active: true, imageFileId: null } });
if (!product) throw new Error("no hay un producto activo sin imagen");
const fileId = "prueba-" + Date.now();
let ok = true;
const check = (name, cond) => { console.log((cond ? "OK   " : "FALLA"), name); ok &&= cond; };

try {
  await prisma.product.update({ where: { id: product.id }, data: { imageFileId: fileId, imageMime: null } });
  const r = await syncProductImages(async () => ({ url: storage, mimeType: "image/png" }));
  check("descargó 1 imagen", r.downloaded === 1 && r.failed === 0);
  check("archivo en disco", existsSync(imagePath(fileId)));
  const res = await fetch(`http://127.0.0.1:4000/product-images/${fileId}`);
  const body = Buffer.from(await res.arrayBuffer());
  check("GET /product-images/:id → 200 image/png con los mismos bytes", res.status === 200 && res.headers.get("content-type") === "image/png" && body.equals(PNG));
  check("id con ../ → 404", (await fetch("http://127.0.0.1:4000/product-images/..%2Fpackage.json")).status === 404);
  const again = await syncProductImages(async () => { throw new Error("no debería volver a bajar"); });
  check("segunda pasada no descarga de nuevo", again.downloaded === 0 && again.failed === 0);
  const failing = await prisma.product.update({ where: { id: product.id }, data: { imageFileId: "prueba-falla-" + Date.now(), imageMime: null } });
  const f = await syncProductImages(async () => { throw new Error("CRM caído"); });
  check("si falla la descarga no rompe y cuenta 1 fallida", f.failed === 1);
  check("la imagen anterior sin uso se borró", !existsSync(imagePath(fileId)));
  void failing;
} finally {
  await prisma.product.update({ where: { id: product.id }, data: { imageFileId: null, imageMime: null } });
  await syncProductImages(async () => { throw new Error("x"); }); // limpia lo que sobre
  server.close();
  await prisma.$disconnect();
}
console.log(ok ? "\nTODO OK" : "\nHAY FALLAS");
process.exit(ok ? 0 : 1);
