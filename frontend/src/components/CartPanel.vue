<script setup lang="ts">
import { ref, watch } from "vue";
import { mdiCartOutline, mdiPlus, mdiMinus, mdiCashRegister, mdiCogOutline, mdiClose, mdiAccountOutline } from "@mdi/js";
import { useCartStore, type Customer } from "../stores/cart";
import { useAuthStore } from "../stores/auth";
import { api } from "../api/client";
import Icon from "./Icon.vue";

const props = defineProps<{ cashSessionId: number | null }>();
const emit = defineEmits<{ checkout: []; closeCash: [] }>();

const cart = useCartStore();
const auth = useAuthStore();

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
</script>

<template>
  <aside class="w-96 shrink-0 bg-white border-l border-gray-200 flex flex-col h-full">
    <div class="p-4 border-b border-gray-200">
      <h2 class="font-semibold text-gray-800 flex items-center gap-1.5">
        <Icon :path="mdiCartOutline" :size="18" class="text-brand-600" />
        Carrito ({{ cart.itemCount }})
      </h2>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-3">
      <p v-if="cart.lines.length === 0" class="text-sm text-gray-400 text-center mt-8">
        Agrega productos tocando el catálogo
      </p>

      <!-- Cliente seleccionado -->
      <div v-if="cart.customer" class="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2 text-sm">
        <div class="flex items-center gap-2 min-w-0">
          <Icon :path="mdiAccountOutline" :size="16" class="text-blue-500 shrink-0" />
          <span class="truncate text-blue-800 font-medium">{{ cart.customer.businessName }}</span>
        </div>
        <button class="text-blue-400 hover:text-blue-600 shrink-0 ml-2" @click="clearCustomer">
          <Icon :path="mdiClose" :size="16" />
        </button>
      </div>

      <!-- Buscar cliente -->
      <div v-if="!cart.customer" class="relative">
        <input
          v-model="customerSearch"
          type="text"
          placeholder="Buscar cliente (nombre, RUC, email)..."
          class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
          @focus="showDropdown = customerResults.length > 0"
          @blur="setTimeout(() => showDropdown = false, 200)"
        />
        <div v-if="showDropdown" class="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          <button
            v-for="c in customerResults"
            :key="c.id"
            class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
            @mousedown.prevent="selectCustomer(c)"
          >
            <span class="font-medium text-gray-800">{{ c.businessName }}</span>
            <span v-if="c.identification" class="ml-2 text-gray-400">{{ c.identification }}</span>
          </button>
        </div>
        <p v-if="searching" class="text-xs text-gray-400 mt-1">Buscando...</p>
      </div>

      <div
        v-for="line in cart.lines"
        :key="line.product.id"
        class="flex items-center justify-between gap-2"
      >
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 truncate">{{ line.product.name }}</p>
          <p class="text-xs text-gray-400">${{ Number(line.product.price).toFixed(2) }} c/u</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button
            class="w-7 h-7 flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200 text-gray-600"
            @click="cart.setQuantity(line.product.id, line.quantity - 1)"
          >
            <Icon :path="mdiMinus" :size="14" />
          </button>
          <span class="w-6 text-center text-sm">{{ line.quantity }}</span>
          <button
            class="w-7 h-7 flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200 text-gray-600"
            @click="cart.setQuantity(line.product.id, line.quantity + 1)"
          >
            <Icon :path="mdiPlus" :size="14" />
          </button>
        </div>
      </div>
    </div>

    <div class="p-4 border-t border-gray-200 space-y-2">
      <!-- Descuento -->
      <div class="flex items-center justify-between text-sm">
        <label for="cart-discount" class="text-gray-500">Descuento</label>
        <div class="flex items-center gap-1">
          <span class="text-gray-400">$</span>
          <input
            id="cart-discount"
            :value="cart.discount"
            type="number"
            min="0"
            step="0.01"
            class="w-20 text-right px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-brand-500 text-sm"
            @input="cart.setDiscount(Number(($event.target as HTMLInputElement).value) || 0)"
          />
        </div>
      </div>

      <!-- Impuesto -->
      <div class="flex items-center justify-between text-sm">
        <label for="cart-tax" class="text-gray-500">Impuesto</label>
        <div class="flex items-center gap-1">
          <span class="text-gray-400">$</span>
          <input
            id="cart-tax"
            :value="cart.tax"
            type="number"
            min="0"
            step="0.01"
            class="w-20 text-right px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-brand-500 text-sm"
            @input="cart.setTax(Number(($event.target as HTMLInputElement).value) || 0)"
          />
        </div>
      </div>

      <div class="border-t border-gray-100 pt-2">
        <div class="flex justify-between text-sm text-gray-500">
          <span>Subtotal</span>
          <span>${{ cart.subtotal.toFixed(2) }}</span>
        </div>
        <div v-if="cart.discount > 0" class="flex justify-between text-sm text-red-500">
          <span>Descuento</span>
          <span>-${{ cart.discount.toFixed(2) }}</span>
        </div>
        <div v-if="cart.tax > 0" class="flex justify-between text-sm text-amber-600">
          <span>Impuesto</span>
          <span>+${{ cart.tax.toFixed(2) }}</span>
        </div>
        <div class="flex justify-between text-lg font-semibold text-gray-800 mt-1">
          <span>Total</span>
          <span>${{ cart.total.toFixed(2) }}</span>
        </div>
      </div>

      <button
        class="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white font-medium py-3 rounded-lg transition mt-2 flex items-center justify-center gap-1.5"
        :disabled="cart.lines.length === 0"
        @click="emit('checkout')"
      >
        <Icon :path="mdiCashRegister" :size="18" />
        Cobrar
      </button>

      <!-- Cerrar caja (solo visible si hay caja abierta y es admin) -->
      <button
        v-if="cashSessionId && auth.isAdmin"
        class="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 rounded-lg transition mt-1 flex items-center justify-center gap-1.5 text-sm"
        @click="emit('closeCash')"
      >
        <Icon :path="mdiCogOutline" :size="16" />
        Cerrar caja
      </button>
    </div>
  </aside>
</template>
