/**
 * Prueba de PARIDAD del IVA entre el POS y billing-service (el CRM).
 *
 * Crea en el CRM productos con tasas DISTINTAS (IVA 15% / IVA 0% / no objeto, con y sin
 * IVA incluido en el precio), hace ventas aleatorias en el POS (cantidades decimales y
 * descuentos), las sube y compara subtotal, IVA y total de CADA venta con la factura real
 * que emitió billing. Cualquier diferencia significa que el cálculo del POS
 * (src/tax/sale-totals.ts) se desvió del de billing.
 *
 * Crea datos: úsala SOLO contra un CRM de desarrollo (Docker local), nunca contra producción.
 *
 *   CRM_URL=http://127.0.0.1:8080 POS_URL=http://127.0.0.1:4000 \
 *   CRM_EMAIL=... CRM_PASSWORD=... POS_USER=... POS_PASSWORD=... \
 *   node scripts/paridad-iva.mjs [numeroDeVentas]
 *
 * Requisitos: el POS emparejado y con caja abierta (o se abre una), y un país con tasas
 * IVA0, IVA15 y NO_OBJETO (Ecuador).
 */
const CRM = process.env.CRM_URL ?? "http://127.0.0.1:8080";
const POS = process.env.POS_URL ?? "http://127.0.0.1:4000";
const N = Number(process.argv[2] ?? 60);
for (const v of ["CRM_EMAIL", "CRM_PASSWORD", "POS_USER", "POS_PASSWORD"]) {
  if (!process.env[v]) throw new Error(`Falta la variable de entorno ${v}`);
}

const json = async (r) => {
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- sesiones ---
const crmLogin = await fetch(`${CRM}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: process.env.CRM_EMAIL, password: process.env.CRM_PASSWORD }),
});
if (crmLogin.status !== 200) throw new Error(`Login en el CRM: ${crmLogin.status}`);
const crmToken = (await json(crmLogin)).accessToken;
const orgId = JSON.parse(Buffer.from(crmToken.split(".")[1], "base64url").toString()).org_id;
const CH = { authorization: `Bearer ${crmToken}`, "x-organization-id": orgId, "content-type": "application/json" };
const crm = async (p, init = {}) => {
  const r = await fetch(`${CRM}${p}`, { ...init, headers: { ...CH, ...(init.headers ?? {}) } });
  return { status: r.status, body: await json(r) };
};

const posLogin = await fetch(`${POS}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: process.env.POS_USER, password: process.env.POS_PASSWORD }),
});
if (posLogin.status !== 200) throw new Error(`Login en el POS: ${posLogin.status}`);
const PH = { authorization: `Bearer ${(await json(posLogin)).token}`, "content-type": "application/json" };
const pos = async (p, init = {}) => {
  const r = await fetch(`${POS}${p}`, { ...init, headers: { ...PH, ...(init.headers ?? {}) } });
  return { status: r.status, body: await json(r) };
};

// --- productos de prueba con IVA distinto cada uno ---
const status = await fetch(`${POS}/setup/status`).then(json);
const establishmentId = status.establishmentId;
if (!status.paired || !establishmentId) throw new Error("El POS no está emparejado");

const rates = (await crm("/countries/EC/tax-rates")).body;
const rateId = Object.fromEntries(rates.map((r) => [r.code, r.id]));
const stamp = Date.now().toString(36);
const defs = [
  ["P15 0.99 excl", "0.99", ["IVA15"], false],
  ["P15 11.50 incl", "11.50", ["IVA15"], true],
  ["P0 2.50 excl", "2.50", ["IVA0"], false],
  ["PNO 4.99 excl", "4.99", ["NO_OBJETO"], false],
  ["P15 3.33 incl", "3.33", ["IVA15"], true],
  ["P15 0.10 excl", "0.10", ["IVA15"], false],
  ["P0 19.99 incl", "19.99", ["IVA0"], true],
];
for (const [name, price, codes, incl] of defs) {
  const r = await crm("/products", {
    method: "POST",
    body: JSON.stringify({
      name: `Paridad ${stamp} ${name}`, type: "good", price, currencyCode: "USD",
      establishmentIds: [establishmentId], taxRateIds: codes.map((c) => rateId[c]), priceIncludesTax: incl,
    }),
  });
  if (r.status >= 300) throw new Error(`No se pudo crear "${name}": ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
}

// El pull corre en segundo plano: se espera a que lleguen todos, con sus impuestos.
await pos("/sync/run", { method: "POST" });
let products = [];
for (let i = 0; i < 90; i++) {
  const all = (await pos("/products")).body;
  products = (all.items ?? all).filter((p) => p.name.startsWith(`Paridad ${stamp}`) && Array.isArray(p.taxes));
  if (products.length === defs.length) break;
  // /sync/run no se repite si ya hay una sincronizacion en curso: se vuelve a pedir.
  if (i % 4 === 3) await pos("/sync/run", { method: "POST" });
  await sleep(1500);
}
if (products.length !== defs.length) throw new Error(`Solo llegaron ${products.length}/${defs.length} productos al POS`);

// --- caja ---
let cash = await pos("/cash-sessions/current");
if (!cash.body?.id) cash = await pos("/cash-sessions/open", { method: "POST", body: JSON.stringify({ openingAmount: 100 }) });
const cashSessionId = cash.body.id;

// --- ventas aleatorias (semilla fija: reproducibles) ---
let seed = 20260925;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const QTY = [1, 1, 2, 3, 5, 0.5, 1.25, 0.333, 7, 10];
const created = [];
for (let n = 0; n < N; n++) {
  const pick = [...products].sort(() => rnd() - 0.5).slice(0, 1 + Math.floor(rnd() * 4));
  const items = pick.map((p) => ({ productId: p.id, quantity: QTY[Math.floor(rnd() * QTY.length)] }));
  let discount = 0;
  if (rnd() < 0.5) {
    const gross = items.reduce(
      (s, it) => s + Math.floor(it.quantity * Math.round(Number(products.find((p) => p.id === it.productId).price) * 100)),
      0,
    );
    discount = Math.floor(rnd() * gross * 0.3) / 100;
  }
  const r = await pos("/sales", { method: "POST", body: JSON.stringify({ cashSessionId, items, discount, paymentMethod: "CASH" }) });
  if (r.status !== 201) { console.log(`venta ${n}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`); continue; }
  created.push(r.body.id);
}

// --- subir y comparar con la factura REAL (con reintentos: un fallo transitorio de red no es una diferencia) ---
// La subida es una venta tras otra: se espera (y se vuelve a pedir) hasta que todas suban.
const want = new Set(created);
for (let i = 0; i < 60; i++) {
  await pos("/sync/run", { method: "POST" });
  await sleep(2500);
  const now = (await pos("/sales")).body.filter((s) => want.has(s.id));
  if (now.every((s) => s.synced)) break;
}
async function invoice(id) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`${CRM}/invoices/${id}`, { headers: CH });
    if (r.status === 200) return json(r);
    await sleep(1500);
  }
  return null;
}
const ids = new Set(created);
const sales = (await pos("/sales")).body.filter((s) => ids.has(s.id));
let ok = 0, diffs = 0, pending = 0, unreachable = 0;
const cents = (v) => Math.round(Number(v) * 100);
for (const s of sales) {
  if (!s.synced || !s.remoteId) { pending++; continue; }
  const inv = await invoice(s.remoteId);
  if (!inv) { unreachable++; continue; }
  if (cents(inv.subtotal) === cents(s.subtotal) && cents(inv.taxTotal) === cents(s.tax) && cents(inv.total) === cents(s.total)) ok++;
  else {
    diffs++;
    console.log(`DIFERENCIA venta ${s.id}: POS ${s.subtotal}/${s.tax}/${s.total} (desc ${s.discount}) | CRM ${inv.subtotal}/${inv.taxTotal}/${inv.total}`);
  }
}
console.log(`\nPARIDAD: ${ok} idénticas, ${diffs} con diferencia, ${pending} sin subir, ${unreachable} sin poder consultar (de ${sales.length})`);
process.exit(diffs === 0 && pending === 0 && unreachable === 0 ? 0 : 1);
