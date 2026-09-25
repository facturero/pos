import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allocateDiscount, computeLine, computeSale, toCents, type LineTaxRate } from './sale-totals.js';

const IVA15: LineTaxRate = { kind: 'vat', percentage: 15 };
const IVA0: LineTaxRate = { kind: 'vat', percentage: 0 };

describe('computeLine — IVA por producto (precio SIN IVA)', () => {
  it('IVA 15%: 2 × 3,50 → base 7,00 + IVA 1,05', () => {
    const r = computeLine({ unitPriceCents: 350, quantity: 2, priceIncludesTax: false, taxes: [IVA15] });
    assert.equal(r.subtotalCents, 700);
    assert.equal(r.taxCents, 105);
    assert.equal(r.totalCents, 805);
  });

  it('IVA 0% y no objeto de IVA: sin impuesto', () => {
    const r = computeLine({ unitPriceCents: 199, quantity: 3, priceIncludesTax: false, taxes: [IVA0] });
    assert.equal(r.subtotalCents, 597);
    assert.equal(r.taxCents, 0);
    assert.equal(r.taxes[0].amountCents, 0);
  });

  it('producto sin tasas: no cobra impuesto', () => {
    const r = computeLine({ unitPriceCents: 1000, quantity: 1, priceIncludesTax: false, taxes: [] });
    assert.equal(r.taxCents, 0);
    assert.equal(r.totalCents, 1000);
  });

  it('redondea igual que billing (Math.round: el .5 sube)', () => {
    // 10,00 × 15% = 1,50 exacto → 2 centavos? no: base 1000 c → 150 c exacto. Caso .5: base 10 c × 15% = 1,5 → 2.
    const r = computeLine({ unitPriceCents: 10, quantity: 1, priceIncludesTax: false, taxes: [IVA15] });
    assert.equal(r.taxCents, 2);
    // 0,99 × 3 = 2,97 → IVA 0,4455 → 45 c
    const r2 = computeLine({ unitPriceCents: 99, quantity: 3, priceIncludesTax: false, taxes: [IVA15] });
    assert.equal(r2.subtotalCents, 297);
    assert.equal(r2.taxCents, 45);
  });

  it('cantidad decimal (peso): 0,333 × 3,00', () => {
    const r = computeLine({ unitPriceCents: 300, quantity: 0.333, priceIncludesTax: false, taxes: [IVA15] });
    assert.equal(r.subtotalCents, Math.round(0.333 * 300));
    assert.equal(r.taxCents, Math.round(r.subtotalCents * 0.15));
  });
});

describe('computeLine — precio CON IVA incluido', () => {
  it('10 × 11,50 con IVA 15% incluido → total 115,00 (no 130: el IVA no se suma dos veces)', () => {
    const r = computeLine({ unitPriceCents: 1150, quantity: 10, priceIncludesTax: true, taxes: [IVA15] });
    assert.equal(r.netUnitCents, 1000);
    assert.equal(r.subtotalCents, 10000);
    assert.equal(r.taxCents, 1500);
    assert.equal(r.totalCents, 11500);
  });

  it('IVA 0% incluido: el precio queda igual', () => {
    const r = computeLine({ unitPriceCents: 250, quantity: 2, priceIncludesTax: true, taxes: [IVA0] });
    assert.equal(r.subtotalCents, 500);
    assert.equal(r.totalCents, 500);
  });

  it('puede haber 1 centavo de diferencia con el precio de góndola por redondeo, pero base × tasa = impuesto', () => {
    const r = computeLine({ unitPriceCents: 199, quantity: 1, priceIncludesTax: true, taxes: [IVA15] });
    assert.equal(r.taxCents, Math.round(r.subtotalCents * 0.15));
    assert.ok(Math.abs(r.totalCents - 199) <= 1);
  });

  it('el descuento también se expresa con IVA y se quita antes de calcular', () => {
    // 2 × 11,50 con IVA incluido, descuento de 1,15 (con IVA) → neto 1,00
    const r = computeLine({ unitPriceCents: 1150, quantity: 2, priceIncludesTax: true, taxes: [IVA15], discountCents: 115 });
    assert.equal(r.netDiscountCents, 100);
    assert.equal(r.subtotalCents, 2000 - 100);
    assert.equal(r.taxCents, Math.round(1900 * 0.15));
  });
});

describe('computeSale — cada línea con SU tasa', () => {
  it('la venta validada de punta a punta: 2 × 3,50 + 1 × 1,75 (IVA 15%) = 10,06', () => {
    const r = computeSale([
      { unitPriceCents: 350, quantity: 2, priceIncludesTax: false, taxes: [IVA15] },
      { unitPriceCents: 175, quantity: 1, priceIncludesTax: false, taxes: [IVA15] },
    ]);
    assert.equal(r.subtotalCents, 875);
    assert.equal(r.taxCents, 131); // 105 + round(26,25) = 26
    assert.equal(r.totalCents, 1006);
  });

  it('cesta mixta: IVA 15% + IVA 0% + precio con IVA incluido', () => {
    const r = computeSale([
      { unitPriceCents: 1000, quantity: 1, priceIncludesTax: false, taxes: [IVA15] }, // 10,00 + 1,50
      { unitPriceCents: 500, quantity: 2, priceIncludesTax: false, taxes: [IVA0] }, // 10,00 + 0
      { unitPriceCents: 1150, quantity: 1, priceIncludesTax: true, taxes: [IVA15] }, // 10,00 + 1,50
    ]);
    assert.equal(r.subtotalCents, 3000);
    assert.equal(r.taxCents, 300);
    assert.equal(r.totalCents, 3300);
    // desglose por tasa: 15% sobre 20,00 = 3,00 ; 0% sobre 10,00 = 0
    assert.deepEqual(
      r.taxBreakdown.map((b) => [b.percentage, b.baseCents, b.amountCents]),
      [[15, 2000, 300], [0, 1000, 0]],
    );
  });

  it('el desglose agrupa por tipo y tasa', () => {
    const r = computeSale([
      { unitPriceCents: 100, quantity: 1, priceIncludesTax: false, taxes: [IVA15] },
      { unitPriceCents: 200, quantity: 1, priceIncludesTax: false, taxes: [IVA15] },
    ]);
    assert.equal(r.taxBreakdown.length, 1);
    assert.equal(r.taxBreakdown[0].baseCents, 300);
  });
});

describe('allocateDiscount — reparto del descuento de la venta entre líneas', () => {
  it('suma exactamente el descuento y es proporcional', () => {
    const out = allocateDiscount([1000, 3000], 400);
    assert.deepEqual(out, [100, 300]);
  });

  it('los centavos sobrantes van a las líneas con mayor resto (a igualdad, la primera)', () => {
    const out = allocateDiscount([100, 100, 100], 100); // 33,33 c cada una → 34,33,33
    assert.equal(out.reduce((s, v) => s + v, 0), 100);
    assert.deepEqual(out, [34, 33, 33]);
  });

  it('sin descuento no reparte nada', () => {
    assert.deepEqual(allocateDiscount([500, 500], 0), [0, 0]);
  });

  it('un descuento mayor que el total se rechaza', () => {
    assert.throws(() => allocateDiscount([100, 200], 301), /descuento/i);
  });

  it('descuento igual al total: cada línea recibe todo lo suyo', () => {
    assert.deepEqual(allocateDiscount([100, 250], 350), [100, 250]);
  });

  it('propiedad: para 500 casos aleatorios suma exacto y nunca supera lo que vale cada línea', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let n = 0; n < 500; n++) {
      const lines = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => 1 + Math.floor(rnd() * 5000));
      const total = lines.reduce((s, v) => s + v, 0);
      const d = Math.floor(rnd() * (total + 1));
      const out = allocateDiscount(lines, d);
      assert.equal(out.reduce((s, v) => s + v, 0), d, `suma ${JSON.stringify({ lines, d, out })}`);
      out.forEach((v, i) => assert.ok(v >= 0 && v <= lines[i], `tope ${JSON.stringify({ lines, d, out })}`));
    }
  });
});

describe('computeSale — con descuento de la venta', () => {
  it('el descuento se reparte por línea, baja la base y el IVA se calcula sobre lo descontado', () => {
    const r = computeSale(
      [
        { unitPriceCents: 1000, quantity: 1, priceIncludesTax: false, taxes: [IVA15] },
        { unitPriceCents: 1000, quantity: 1, priceIncludesTax: false, taxes: [IVA0] },
      ],
      200,
    );
    assert.deepEqual(r.lineDiscountsCents, [100, 100]);
    assert.equal(r.subtotalCents, 1800);
    assert.equal(r.taxCents, Math.round(900 * 0.15));
    assert.equal(r.totalCents, 1800 + Math.round(900 * 0.15));
  });
});

describe('toCents', () => {
  it('convierte decimales del catálogo igual que billing', () => {
    assert.equal(toCents('3.50'), 350);
    assert.equal(toCents(1.75), 175);
    assert.equal(toCents('0.10'), 10);
  });
});
