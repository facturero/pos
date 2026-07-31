import { defineStore } from "pinia";

export interface Product {
  id: number;
  name: string;
  price: string; // Decimal viene serializado como string desde Prisma/JSON
  stock: string;
  unit: string;
  sku: string | null;
  barcode: string | null;
  categoryId: number | null;
}

export interface CartLine {
  product: Product;
  quantity: number;
}

export const useCartStore = defineStore("cart", {
  state: () => ({
    lines: [] as CartLine[],
    discount: 0,
    tax: 0,
  }),
  getters: {
    subtotal: (state) =>
      state.lines.reduce((sum, line) => sum + Number(line.product.price) * line.quantity, 0),
    total(): number {
      return this.subtotal + this.tax - this.discount;
    },
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
    clear() {
      this.lines = [];
      this.discount = 0;
      this.tax = 0;
    },
  },
});
