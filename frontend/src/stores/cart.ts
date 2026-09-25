import { defineStore } from "pinia";
import { api, ApiError } from "../api/client";

export interface Product {
  id: number;
  name: string;
  price: string; // Decimal viene serializado como string desde Prisma/JSON
  stock: string;
  unit: string;
  sku: string | null;
  barcode: string | null;
  categoryId: number | null;
  // Imagen principal (id del archivo en el CRM); el backend del POS la sirve si ya la descargó.
  imageFileId?: string | null;
  // Impuestos: cada producto trae los suyos (IVA 15%, IVA 0%...). El cálculo lo hace el
  // backend del POS (POST /sales/preview); aquí solo se muestran.
  priceIncludesTax?: boolean;
  taxes?: Array<{ kind: string; percentage: number }> | null;
}

export interface Customer {
  id: number;
  businessName: string;
  tradeName: string | null;
  identification: string | null;
  email: string | null;
}

export interface CartLine {
  product: Product;
  quantity: number;
}

// Totales que calcula el backend del POS con el IVA de CADA producto (mismo algoritmo que
// la factura del CRM). subtotal = base imponible (sin IVA, ya descontada).
export interface TaxBreakdownEntry {
  kind: string;
  percentage: number;
  base: number;
  amount: number;
}

export interface CartQuote {
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  taxBreakdown: TaxBreakdownEntry[];
}

export const useCartStore = defineStore("cart", {
  state: () => ({
    lines: [] as CartLine[],
    discount: 0,
    customer: null as Customer | null,
    // null mientras no se ha calculado. quoteError: el backend rechazó el carrito (p. ej. un
    // producto sin impuestos sincronizados); en ese caso no se puede cobrar.
    quote: null as CartQuote | null,
    quoteError: null as string | null,
  }),
  getters: {
    subtotal: (state) => state.quote?.subtotal ?? 0,
    tax: (state) => state.quote?.tax ?? 0,
    taxBreakdown: (state) => state.quote?.taxBreakdown ?? [],
    total: (state) => state.quote?.total ?? 0,
    itemCount: (state) => state.lines.reduce((sum, line) => sum + line.quantity, 0),
  },
  actions: {
    addProduct(product: Product, quantity = 1) {
      const existing = this.lines.find((l) => l.product.id === product.id);
      if (existing) {
        existing.quantity += quantity;
      } else {
        this.lines.push({ product, quantity });
      }
    },
    setQuantity(productId: number, quantity: number) {
      const line = this.lines.find((l) => l.product.id === productId);
      if (!line) return;
      if (quantity <= 0) {
        this.removeLine(productId);
      } else {
        line.quantity = quantity;
      }
    },
    removeLine(productId: number) {
      this.lines = this.lines.filter((l) => l.product.id !== productId);
    },
    setDiscount(value: number) {
      this.discount = value;
    },
    setCustomer(c: Customer | null) {
      this.customer = c;
    },
    // Pide al backend los totales con IVA. Se llama al cambiar el carrito o el descuento.
    async refreshQuote() {
      if (this.lines.length === 0) {
        this.quote = null;
        this.quoteError = null;
        return;
      }
      const signature = () => JSON.stringify([this.lines.map((l) => [l.product.id, l.quantity]), this.discount]);
      const requested = signature();
      try {
        const quote = await api.post<CartQuote>("/sales/preview", {
          items: this.lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
          discount: this.discount,
        });
        // Si el carrito cambió mientras se calculaba, esta respuesta ya está vieja.
        if (signature() !== requested) return;
        this.quote = quote;
        this.quoteError = null;
      } catch (err) {
        if (signature() !== requested) return;
        this.quote = null;
        this.quoteError = err instanceof ApiError ? err.message : "No se pudo calcular el total";
      }
    },
    clear() {
      this.lines = [];
      this.discount = 0;
      this.customer = null;
      this.quote = null;
      this.quoteError = null;
    },
  },
});
