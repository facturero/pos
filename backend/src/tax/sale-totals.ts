/**
 * Cálculo de impuestos y totales de una venta del POS.
 *
 * DEBE dar el MISMO resultado que billing-service cuando convierte la venta en factura
 * (`addLineInTransaction`, backend/billing-service): si difiere aunque sea un centavo,
 * lo que la caja cobra no coincide con la factura legal. Por eso replica su algoritmo
 * operación por operación y con el mismo redondeo (`Math.round`):
 *
 *   neto     = round(precio / (1 + Σ tasas/100))      solo si el precio incluye IVA
 *   subtotal = round(cantidad × neto unitario) − neto del descuento
 *   impuesto = round(subtotal × tasa/100)             uno por cada tasa del producto
 *
 * El IVA es POR PRODUCTO: cada producto trae sus propias tasas (IVA 15%, IVA 0%, no
 * objeto de IVA...). No existe una tasa general.
 *
 * Dos rarezas de billing que se copian a propósito para no desviarse:
 *  - Si el precio incluye impuestos, se le quita la SUMA de todas las tasas del producto
 *    (también las de retención); en la práctica un producto de venta solo lleva IVA.
 *  - El total de impuestos suma todos los tipos de tasa.
 *
 * Los importes son enteros en centavos, como en billing.
 */

export interface LineTaxRate {
  /** uuid de la tasa en tax-service (para el desglose; opcional en los cálculos). */
  taxRateId?: string;
  kind: string;
  /** Porcentaje, p. ej. 15 para IVA 15%. */
  percentage: number;
}

export interface PricedLineInput {
  /** Precio unitario del catálogo, en centavos (con IVA dentro si `priceIncludesTax`). */
  unitPriceCents: number;
  quantity: number;
  priceIncludesTax: boolean;
  taxes: LineTaxRate[];
  /** Descuento de la línea en las MISMAS unidades que el precio (con IVA si el precio lo incluye). */
  discountCents?: number;
}

export interface LineTaxResult {
  taxRateId?: string;
  kind: string;
  percentage: number;
  baseCents: number;
  amountCents: number;
}

export interface LineResult {
  netUnitCents: number;
  netDiscountCents: number;
  /** Base imponible de la línea: sin impuestos y ya descontada. */
  subtotalCents: number;
  taxes: LineTaxResult[];
  taxCents: number;
  totalCents: number;
}

export function computeLine(line: PricedLineInput): LineResult {
  const includedRatePercent = line.priceIncludesTax ? line.taxes.reduce((sum, t) => sum + t.percentage, 0) : 0;
  const withoutTax = (cents: number) => Math.round(cents / (1 + includedRatePercent / 100));

  const netUnitCents = withoutTax(line.unitPriceCents);
  const netDiscountCents = withoutTax(line.discountCents ?? 0);
  const subtotalCents = Math.round(line.quantity * netUnitCents) - netDiscountCents;

  const taxes: LineTaxResult[] = line.taxes.map((t) => ({
    taxRateId: t.taxRateId,
    kind: t.kind,
    percentage: t.percentage,
    baseCents: subtotalCents,
    amountCents: Math.round(subtotalCents * (t.percentage / 100)),
  }));
  const taxCents = taxes.reduce((sum, t) => sum + t.amountCents, 0);

  return { netUnitCents, netDiscountCents, subtotalCents, taxes, taxCents, totalCents: subtotalCents + taxCents };
}

/**
 * Reparte el descuento de la venta entre las líneas, en proporción a lo que vale cada
 * una (billing solo admite descuento POR LÍNEA). El reparto suma exactamente
 * `discountCents`: se redondea hacia abajo y los centavos sobrantes van a las líneas con
 * mayor resto (a igualdad, la primera). Ninguna línea recibe más de lo que vale.
 */
export function allocateDiscount(grossCents: number[], discountCents: number): number[] {
  const totalGross = grossCents.reduce((s, g) => s + g, 0);
  if (discountCents <= 0 || totalGross <= 0) return grossCents.map(() => 0);
  if (discountCents > totalGross) throw new Error('El descuento no puede ser mayor al total de la venta');

  const exact = grossCents.map((g) => (discountCents * g) / totalGross);
  const shares = exact.map((x) => Math.floor(x + 1e-9));
  let remainder = discountCents - shares.reduce((s, v) => s + v, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x + 1e-9) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    if (shares[i] < grossCents[i]) {
      shares[i] += 1;
      remainder -= 1;
    }
  }
  return shares;
}

export interface SaleInputLine extends Omit<PricedLineInput, 'discountCents'> {}

export interface TaxBreakdownEntry {
  kind: string;
  percentage: number;
  baseCents: number;
  amountCents: number;
}

export interface SaleResult {
  lines: LineResult[];
  /** Descuento de la venta repartido por línea (mismas unidades que el precio). */
  lineDiscountsCents: number[];
  /** Suma de las bases imponibles (sin impuestos, ya descontadas) = subtotal de la factura. */
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  taxBreakdown: TaxBreakdownEntry[];
}

export function computeSale(lines: SaleInputLine[], saleDiscountCents = 0): SaleResult {
  // Base del reparto y tope por línea: lo que billing acepta como descuento máximo
  // (cantidad × precio unitario), sin redondear hacia arriba.
  const gross = lines.map((l) => Math.floor(l.quantity * l.unitPriceCents + 1e-9));
  const lineDiscountsCents = allocateDiscount(gross, saleDiscountCents);

  const results = lines.map((l, i) => computeLine({ ...l, discountCents: lineDiscountsCents[i] }));

  const subtotalCents = results.reduce((s, r) => s + r.subtotalCents, 0);
  const taxCents = results.reduce((s, r) => s + r.taxCents, 0);

  const groups = new Map<string, TaxBreakdownEntry>();
  for (const r of results) {
    for (const t of r.taxes) {
      const key = `${t.kind}|${t.percentage}`;
      const g = groups.get(key) ?? { kind: t.kind, percentage: t.percentage, baseCents: 0, amountCents: 0 };
      g.baseCents += t.baseCents;
      g.amountCents += t.amountCents;
      groups.set(key, g);
    }
  }

  return {
    lines: results,
    lineDiscountsCents,
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    taxBreakdown: [...groups.values()].sort((a, b) => b.percentage - a.percentage),
  };
}

/** Decimal del catálogo (número o texto "3.50") → centavos, igual que billing (`round(x × 100)`). */
export function toCents(value: number | string): number {
  return Math.round(Number(value) * 100);
}
