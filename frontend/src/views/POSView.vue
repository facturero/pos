<script setup lang="ts">
import { ref, onMounted, watch, computed } from "vue";
import { api, ApiError } from "../api/client";
import { useCartStore, type Product } from "../stores/cart";
import ProductCard from "../components/ProductCard.vue";
import CartPanel from "../components/CartPanel.vue";
import Icon from "../components/Icon.vue";
import { mdiMagnify, mdiCashRegister, mdiCloseCircleOutline } from "@mdi/js";

interface Category {
  id: number;
  name: string;
}

interface CashSession {
  id: number;
  status: "OPEN" | "CLOSED";
  openingAmount: string;
}

const cart = useCartStore();

const products = ref<Product[]>([]);
const categories = ref<Category[]>([]);
const selectedCategoryId = ref<number | null>(null);
const search = ref("");
const loadingProducts = ref(false);

const cashSession = ref<CashSession | null>(null);
const openingAmountInput = ref("0");
const checkingSession = ref(true);

const checkoutOpen = ref(false);
const paymentMethod = ref<"CASH" | "CARD" | "TRANSFER" | "OTHER">("CASH");
const checkoutError = ref<string | null>(null);
const checkoutLoading = ref(false);

const closeCashOpen = ref(false);
const closingAmountInput = ref("0");
const closeCashNotes = ref("");
const closeCashError = ref<string | null>(null);
const closeCashLoading = ref(false);

const expectedAmount = computed(() => {
  if (!cashSession.value) return 0;
  return Number(cashSession.value.openingAmount);
});

async function loadCashSession() {
  checkingSession.value = true;
  try {
    cashSession.value = await api.get<CashSession | null>("/cash-sessions/current");
  } finally {
    checkingSession.value = false;
  }
}

async function openCashSession() {
  const amount = Number(openingAmountInput.value) || 0;
  cashSession.value = await api.post<CashSession>("/cash-sessions/open", { openingAmount: amount });
}

async function closeCashSession() {
  if (!cashSession.value) return;
  closeCashLoading.value = true;
  closeCashError.value = null;
  try {
    await api.post(`/cash-sessions/${cashSession.value.id}/close`, {
      closingAmount: Number(closingAmountInput.value) || 0,
      notes: closeCashNotes.value || undefined,
    });
    cashSession.value = null;
    closeCashOpen.value = false;
    closingAmountInput.value = "0";
    closeCashNotes.value = "";
  } catch (err) {
    closeCashError.value = err instanceof ApiError ? err.message : "Error al cerrar caja";
  } finally {
    closeCashLoading.value = false;
  }
}

async function loadCategories() {
  categories.value = await api.get<Category[]>("/categories");
}

async function loadProducts() {
  loadingProducts.value = true;
  try {
    const params = new URLSearchParams();
    if (search.value) params.set("search", search.value);
    if (selectedCategoryId.value) params.set("categoryId", String(selectedCategoryId.value));
    const qs = params.toString() ? `?${params.toString()}` : "";
    products.value = await api.get<Product[]>(`/products${qs}`);
  } finally {
    loadingProducts.value = false;
  }
}

let searchTimeout: ReturnType<typeof setTimeout> | null = null;
watch(search, () => {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(loadProducts, 300);
});

watch(selectedCategoryId, () => {
  loadProducts();
});

function selectProduct(product: Product) {
  cart.addProduct(product, 1);
}

function selectCategory(id: number | null) {
  selectedCategoryId.value = id;
}

async function confirmCheckout() {
  if (!cashSession.value) return;
  checkoutLoading.value = true;
  checkoutError.value = null;
  try {
    await api.post("/sales", {
      cashSessionId: cashSession.value.id,
      customerId: cart.customer?.id ?? undefined,
      items: cart.lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
      discount: cart.discount,
      tax: cart.tax,
      paymentMethod: paymentMethod.value,
    });
    cart.clear();
    checkoutOpen.value = false;
    await loadProducts();
  } catch (err) {
    checkoutError.value = err instanceof ApiError ? err.message : "Error al procesar la venta";
  } finally {
    checkoutLoading.value = false;
  }
}

onMounted(async () => {
  await loadCashSession();
  await Promise.all([loadCategories(), loadProducts()]);
});
</script>

<template>
  <div class="h-full flex">
    <!-- Bloqueo de apertura de caja: no se puede vender sin caja abierta -->
    <div
      v-if="!checkingSession && !cashSession"
      class="fixed inset-0 bg-black/40 flex items-center justify-center z-20"
    >
      <div class="bg-white rounded-xl p-6 w-full max-w-sm">
        <h2 class="font-semibold text-gray-800 mb-4">Abrir caja</h2>
        <label class="block text-sm text-gray-600 mb-1">Monto inicial en efectivo</label>
        <input
          v-model="openingAmountInput"
          type="number"
          step="0.01"
          class="w-full mb-4 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          class="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium py-2 rounded-lg"
          @click="openCashSession"
        >
          Abrir caja
        </button>
      </div>
    </div>

    <section class="flex-1 min-w-0 flex flex-col">
      <!-- Barra de búsqueda + categoría -->
      <div class="p-4 border-b border-gray-200 bg-white space-y-3">
        <div class="relative">
          <Icon
            :path="mdiMagnify"
            :size="18"
            class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            v-model="search"
            type="text"
            placeholder="Buscar producto, SKU o código de barras..."
            class="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div class="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
          <button
            class="shrink-0 px-3 py-1.5 text-sm rounded-full border transition"
            :class="selectedCategoryId === null
              ? 'bg-brand-600 text-white border-brand-600'
              : 'bg-white text-gray-600 border-gray-300 hover:border-brand-400'"
            @click="selectCategory(null)"
          >
            Todos
          </button>
          <button
            v-for="cat in categories"
            :key="cat.id"
            class="shrink-0 px-3 py-1.5 text-sm rounded-full border transition"
            :class="selectedCategoryId === cat.id
              ? 'bg-brand-600 text-white border-brand-600'
              : 'bg-white text-gray-600 border-gray-300 hover:border-brand-400'"
            @click="selectCategory(cat.id)"
          >
            {{ cat.name }}
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-4">
        <div v-if="loadingProducts" class="text-sm text-gray-400">Cargando...</div>
        <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <ProductCard
            v-for="product in products"
            :key="product.id"
            :product="product"
            @select="selectProduct"
          />
        </div>
        <p v-if="!loadingProducts && products.length === 0" class="text-sm text-gray-400 text-center mt-8">
          Sin resultados. Verifica que el catálogo ya se haya sincronizado.
        </p>
      </div>
    </section>

    <CartPanel
      :cash-session-id="cashSession?.id ?? null"
      @checkout="checkoutOpen = true"
      @close-cash="closeCashOpen = true"
    />

    <!-- Modal de cobro -->
    <div
      v-if="checkoutOpen"
      class="fixed inset-0 bg-black/40 flex items-center justify-center z-20"
      @click.self="checkoutOpen = false"
    >
      <div class="bg-white rounded-xl p-6 w-full max-w-sm">
        <h2 class="font-semibold text-gray-800 mb-4">Confirmar cobro</h2>
        <p class="text-2xl font-bold text-gray-800 mb-4">${{ cart.total.toFixed(2) }}</p>

        <label class="block text-sm text-gray-600 mb-1">Método de pago</label>
        <select
          v-model="paymentMethod"
          class="w-full mb-4 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="CASH">Efectivo</option>
          <option value="CARD">Tarjeta</option>
          <option value="TRANSFER">Transferencia</option>
          <option value="OTHER">Otro</option>
        </select>

        <p v-if="checkoutError" class="text-sm text-red-600 mb-3">{{ checkoutError }}</p>

        <div class="flex gap-2">
          <button
            class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 rounded-lg"
            @click="checkoutOpen = false"
          >
            Cancelar
          </button>
          <button
            class="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg flex items-center justify-center gap-1.5"
            :disabled="checkoutLoading"
            @click="confirmCheckout"
          >
            <Icon :path="mdiCashRegister" :size="18" />
            {{ checkoutLoading ? "Procesando..." : "Confirmar" }}
          </button>
        </div>
      </div>
    </div>

    <!-- Modal de cerrar caja -->
    <div
      v-if="closeCashOpen"
      class="fixed inset-0 bg-black/40 flex items-center justify-center z-20"
      @click.self="closeCashOpen = false"
    >
      <div class="bg-white rounded-xl p-6 w-full max-w-sm">
        <div class="flex items-center justify-between mb-4">
          <h2 class="font-semibold text-gray-800">Cerrar caja</h2>
          <button class="text-gray-400 hover:text-gray-600" @click="closeCashOpen = false">
            <Icon :path="mdiCloseCircleOutline" :size="20" />
          </button>
        </div>

        <div class="bg-gray-50 rounded-lg p-3 mb-4 text-sm space-y-1">
          <div class="flex justify-between text-gray-600">
            <span>Monto de apertura</span>
            <span>${{ cashSession ? Number(cashSession.openingAmount).toFixed(2) : "0.00" }}</span>
          </div>
        </div>

        <label class="block text-sm text-gray-600 mb-1">Monto contado en efectivo</label>
        <input
          v-model="closingAmountInput"
          type="number"
          step="0.01"
          class="w-full mb-3 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          placeholder="0.00"
        />

        <label class="block text-sm text-gray-600 mb-1">Notas (opcional)</label>
        <textarea
          v-model="closeCashNotes"
          rows="2"
          class="w-full mb-4 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
          placeholder="Observaciones del cierre..."
        />

        <p v-if="closeCashError" class="text-sm text-red-600 mb-3">{{ closeCashError }}</p>

        <div class="flex gap-2">
          <button
            class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 rounded-lg"
            @click="closeCashOpen = false"
          >
            Cancelar
          </button>
          <button
            class="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg"
            :disabled="closeCashLoading"
            @click="closeCashSession"
          >
            {{ closeCashLoading ? "Cerrando..." : "Cerrar caja" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
