<script setup lang="ts">
import { ref, watch } from "vue";
import { mdiCartOutline, mdiPlus, mdiMinus, mdiCashRegister, mdiCogOutline, mdiClose, mdiAccountOutline } from "@mdi/js";
import { useCartStore, type Customer, type TaxBreakdownEntry } from "../stores/cart";
import { useAuthStore } from "../stores/auth";
import { useThemeStore } from "../stores/theme";
import { api } from "../api/client";
import Icon from "./Icon.vue";

const props = defineProps<{ cashSessionId: number | null }>();
const emit = defineEmits<{ checkout: []; closeCash: [] }>();

const cart = useCartStore();
const auth = useAuthStore();
const theme = useThemeStore();

// Nombre de cada fila de impuesto: "IVA 15%", "IVA 0%"... (los tipos de retención no aplican a una venta de caja).
function taxLabel(t: TaxBreakdownEntry): string {
  const name = t.kind === "vat" ? "IVA" : t.kind;
  return `${name} ${Number.isInteger(t.percentage) ? t.percentage : t.percentage.toFixed(2)}%`;
}

const customerSearch = ref("");
const customerResults = ref<Customer[]>([]);
const searching = ref(false);
const showDropdown = ref(false);

let searchTimeout: ReturnType<typeof setTimeout> | null = null;
watch(customerSearch, (val) => {
  if (searchTimeout) clearTimeout(searchTimeout);
  if (!val.trim()) {
    customerResults.value = [];
    showDropdown.value = false;
    return;
  }
  searchTimeout = setTimeout(async () => {
    searching.value = true;
    try {
      customerResults.value = await api.get<Customer[]>(`/customers?q=${encodeURIComponent(val)}`);
      showDropdown.value = customerResults.value.length > 0;
    } catch {
      customerResults.value = [];
    } finally {
      searching.value = false;
    }
  }, 250);
});

function selectCustomer(c: Customer) {
  cart.setCustomer(c);
  customerSearch.value = "";
  customerResults.value = [];
  showDropdown.value = false;
}

function clearCustomer() {
  cart.setCustomer(null);
}

// El @blur del input de cliente cierra el dropdown con un pequeño retraso para
// que el @mousedown.prevent del resultado tenga tiempo de ejecutarse antes.
function hideDropdownLater() {
  window.setTimeout(() => {
    showDropdown.value = false;
  }, 200);
}
</script>

<template>
  <!-- Ancho y lado los decide el tema (layout.cartWidth / cartPosition). -->
  <aside
    class="shrink-0 bg-surface border-line flex flex-col h-full"
    :class="[
      { narrow: 'w-72', normal: 'w-96', wide: 'w-[30rem]' }[theme.layout.cartWidth],
      theme.layout.cartPosition === 'left' ? 'border-r' : 'border-l',
    ]"
  >
    <div class="p-4 border-b border-line">
      <h2 class="text-ink flex items-center gap-1.5">
        <Icon :path="mdiCartOutline" :size="18" class="text-primary" />
        Carrito ({{ cart.itemCount }})
      </h2>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-3">
      <p v-if="cart.lines.length === 0" class="text-sm text-muted/70 text-center mt-8">
        Agrega productos tocando el catálogo
      </p>

      <!-- Cliente seleccionado -->
      <div v-if="cart.customer" class="flex items-center justify-between bg-primary-soft rounded-lg px-3 py-2 text-sm">
        <div class="flex items-center gap-2 min-w-0">
          <Icon :path="mdiAccountOutline" :size="16" class="text-primary shrink-0" />
          <span class="truncate text-primary font-medium">{{ cart.customer.businessName }}</span>
        </div>
        <button class="text-primary/70 hover:text-primary shrink-0 ml-2" @click="clearCustomer">
          <Icon :path="mdiClose" :size="16" />
        </button>
      </div>

      <!-- Buscar cliente -->
      <div v-if="!cart.customer" class="relative">
        <input
          v-model="customerSearch"
          type="text"
          placeholder="Buscar cliente (nombre, RUC, email)..."
          class="w-full px-3 py-2 border border-line-strong rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/70"
          @focus="showDropdown = customerResults.length > 0"
          @blur="hideDropdownLater"
        />
        <div v-if="showDropdown" class="absolute z-10 w-full mt-1 bg-surface border border-line rounded-lg shadow-lg max-h-48 overflow-y-auto">
          <button
            v-for="c in customerResults"
            :key="c.id"
            class="w-full text-left px-3 py-2 text-sm hover:bg-page border-b border-surface-alt last:border-0"
            @mousedown.prevent="selectCustomer(c)"
          >
            <span class="font-medium text-ink">{{ c.businessName }}</span>
            <span v-if="c.identification" class="ml-2 text-muted/70">{{ c.identification }}</span>
          </button>
        </div>
        <p v-if="searching" class="text-xs text-muted/70 mt-1">Buscando...</p>
      </div>

      <div
        v-for="line in cart.lines"
        :key="line.product.id"
        class="flex items-center justify-between gap-2"
      >
        <div class="min-w-0">
          <p class="text-sm font-medium text-ink truncate">{{ line.product.name }}</p>
          <p class="text-xs text-muted/70">${{ Number(line.product.price).toFixed(2) }} c/u</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button
            class="w-7 h-7 flex items-center justify-center rounded bg-surface-alt hover:bg-line text-ink/80"
            @click="cart.setQuantity(line.product.id, line.quantity - 1)"
          >
            <Icon :path="mdiMinus" :size="14" />
          </button>
          <span class="w-6 text-center text-sm">{{ line.quantity }}</span>
          <button
            class="w-7 h-7 flex items-center justify-center rounded bg-surface-alt hover:bg-line text-ink/80"
            @click="cart.setQuantity(line.product.id, line.quantity + 1)"
          >
            <Icon :path="mdiPlus" :size="14" />
          </button>
        </div>
      </div>
    </div>

    <div class="p-4 border-t border-line space-y-2">
      <!-- Descuento -->
      <div class="flex items-center justify-between text-sm">
        <label for="cart-discount" class="text-muted">Descuento</label>
        <div class="flex items-center gap-1">
          <span class="text-muted/70">$</span>
          <input
            id="cart-discount"
            :value="cart.discount"
            type="number"
            min="0"
            step="0.01"
            class="w-20 text-right px-2 py-1 border border-line-strong rounded focus:outline-none focus:ring-1 focus:ring-primary/70 text-sm"
            @input="cart.setDiscount(Number(($event.target as HTMLInputElement).value) || 0)"
          />
        </div>
      </div>

      <!-- El impuesto ya no se escribe a mano: se calcula por producto (cada uno tiene su IVA). -->
      <div class="border-t border-surface-alt pt-2">
        <div class="flex justify-between text-sm text-muted">
          <span>Subtotal (sin IVA)</span>
          <span>${{ cart.subtotal.toFixed(2) }}</span>
        </div>
        <div v-if="cart.discount > 0" class="flex justify-between text-sm text-danger/80">
          <span>Descuento incluido</span>
          <span>-${{ cart.discount.toFixed(2) }}</span>
        </div>
        <!-- Una fila por tasa: IVA 15%, IVA 0%... con la base sobre la que se aplica -->
        <div
          v-for="t in cart.taxBreakdown"
          :key="`${t.kind}-${t.percentage}`"
          class="flex justify-between text-sm text-warning"
        >
          <span>{{ taxLabel(t) }} <span class="text-muted/70">(base ${{ t.base.toFixed(2) }})</span></span>
          <span>+${{ t.amount.toFixed(2) }}</span>
        </div>
        <p v-if="cart.quoteError" class="text-xs text-danger mt-1" role="alert">
          {{ cart.quoteError }}
        </p>
        <div class="flex justify-between text-lg font-semibold text-ink mt-1">
          <span>Total</span>
          <span>${{ cart.total.toFixed(2) }}</span>
        </div>
      </div>

      <button
        class="w-full bg-primary hover:bg-primary-hover disabled:opacity-40 text-primary-on font-medium py-3 rounded-lg transition mt-2 flex items-center justify-center gap-1.5"
        :disabled="cart.lines.length === 0 || !cart.quote || !!cart.quoteError"
        @click="emit('checkout')"
      >
        <Icon :path="mdiCashRegister" :size="18" />
        Cobrar
      </button>

      <!-- Cerrar caja (solo visible si hay caja abierta y es admin) -->
      <button
        v-if="cashSessionId && auth.isAdmin"
        class="w-full bg-surface-alt hover:bg-line text-ink/90 font-medium py-2 rounded-lg transition mt-1 flex items-center justify-center gap-1.5 text-sm"
        @click="emit('closeCash')"
      >
        <Icon :path="mdiCogOutline" :size="16" />
        Cerrar caja
      </button>
    </div>
  </aside>
</template>
