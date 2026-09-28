<script setup lang="ts">
import { ref, onMounted, watch, computed } from "vue";
import { api, ApiError } from "../api/client";
import { useCartStore, type Product } from "../stores/cart";
import { usePreferencesStore } from "../stores/preferences";
import { useThemeStore } from "../stores/theme";
import ProductCard from "../components/ProductCard.vue";
import CartPanel from "../components/CartPanel.vue";
import Icon from "../components/Icon.vue";
import { mdiMagnify, mdiCashRegister, mdiCloseCircleOutline, mdiImageOutline, mdiImageOffOutline } from "@mdi/js";

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
const preferences = usePreferencesStore();
const theme = useThemeStore();

// Columnas del catálogo: "auto" es la cuadrícula responsiva de siempre; un número fija las columnas.
const gridColumnsStyle = computed(() => {
  const c = theme.layout.catalogColumns;
  return c === "auto" ? undefined : { gridTemplateColumns: `repeat(${c}, minmax(0, 1fr))` };
});

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

// Los totales con IVA los calcula el backend del POS (una sola implementación, la misma que
// se guarda y se factura): se piden al cambiar las líneas, las cantidades o el descuento.
// Con un pequeño retraso para no lanzar una petición por cada tecla del descuento.
let quoteTimeout: ReturnType<typeof setTimeout> | null = null;
watch(
  () => [cart.lines.map((l) => [l.product.id, l.quantity]), cart.discount],
  () => {
    if (quoteTimeout) clearTimeout(quoteTimeout);
    quoteTimeout = setTimeout(() => void cart.refreshQuote(), 120);
  },
  { deep: true },
);

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
      // El IVA ya no se manda: el backend lo calcula por producto (cada uno tiene el suyo).
      discount: cart.discount,
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
  <!-- El carrito puede ir a izquierda o derecha (tema): flex-row-reverse invierte el orden sin duplicar nada. -->
  <div class="h-full flex" :class="theme.layout.cartPosition === 'left' ? 'flex-row-reverse' : ''">
    <!-- Bloqueo de apertura de caja: no se puede vender sin caja abierta -->
    <div
      v-if="!checkingSession && !cashSession"
      class="fixed inset-0 bg-black/40 flex items-center justify-center z-20"
    >
      <div class="bg-surface rounded-xl p-6 w-full max-w-sm">
        <h2 class="text-ink mb-4">Abrir caja</h2>
        <label class="block text-sm text-ink/80 mb-1">Monto inicial en efectivo</label>
        <input
          v-model="openingAmountInput"
          type="number"
          step="0.01"
          class="w-full mb-4 px-3 py-2 border border-line-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/70"
        />
        <button
          class="w-full bg-primary hover:bg-primary-hover text-primary-on font-medium py-2 rounded-lg"
          @click="openCashSession"
        >
          Abrir caja
        </button>
      </div>
    </div>

    <section class="flex-1 min-w-0 flex flex-col">
      <!-- Barra de búsqueda + categoría -->
      <div class="p-4 border-b border-line bg-surface space-y-3">
        <div class="flex gap-2">
          <div class="relative flex-1">
            <Icon
              :path="mdiMagnify"
              :size="18"
              class="absolute left-3 top-1/2 -translate-y-1/2 text-muted/70"
            />
            <input
              v-model="search"
              type="text"
              placeholder="Buscar producto, SKU o código de barras..."
              class="w-full pl-10 pr-4 py-2 border border-line-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/70"
            />
          </div>
          <!-- Ver el catálogo con o sin fotos (preferencia de esta caja) -->
          <button
            class="shrink-0 w-10 flex items-center justify-center rounded-lg border transition"
            :class="preferences.showImages
              ? 'bg-primary text-primary-on border-primary'
              : 'bg-surface text-muted border-line-strong hover:border-primary/60'"
            :title="preferences.showImages ? 'Ocultar imágenes' : 'Mostrar imágenes'"
            :aria-pressed="preferences.showImages"
            aria-label="Mostrar imágenes de los productos"
            @click="preferences.setShowImages(!preferences.showImages)"
          >
            <Icon :path="preferences.showImages ? mdiImageOutline : mdiImageOffOutline" :size="20" />
          </button>
        </div>
        <div v-if="theme.layout.categoriesPlacement === 'top'" class="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
          <button
            class="shrink-0 px-3 py-1.5 text-sm rounded-full border transition"
            :class="selectedCategoryId === null
              ? 'bg-primary text-primary-on border-primary'
              : 'bg-surface text-ink/80 border-line-strong hover:border-primary/60'"
            @click="selectCategory(null)"
          >
            Todos
          </button>
          <button
            v-for="cat in categories"
            :key="cat.id"
            class="shrink-0 px-3 py-1.5 text-sm rounded-full border transition"
            :class="selectedCategoryId === cat.id
              ? 'bg-primary text-primary-on border-primary'
              : 'bg-surface text-ink/80 border-line-strong hover:border-primary/60'"
            @click="selectCategory(cat.id)"
          >
            {{ cat.name }}
          </button>
        </div>
      </div>

      <div class="flex-1 min-h-0 flex">
        <!-- Categorías en columna lateral (tema: categoriesPlacement = left) -->
        <nav
          v-if="theme.layout.categoriesPlacement === 'left'"
          class="w-40 shrink-0 border-r border-line bg-surface overflow-y-auto p-2 flex flex-col gap-1"
        >
          <button
            class="text-left px-3 py-2 text-sm rounded-lg transition"
            :class="selectedCategoryId === null ? 'bg-primary text-primary-on' : 'text-ink/80 hover:bg-page'"
            @click="selectCategory(null)"
          >
            Todos
          </button>
          <button
            v-for="cat in categories"
            :key="cat.id"
            class="text-left px-3 py-2 text-sm rounded-lg transition"
            :class="selectedCategoryId === cat.id ? 'bg-primary text-primary-on' : 'text-ink/80 hover:bg-page'"
            @click="selectCategory(cat.id)"
          >
            {{ cat.name }}
          </button>
        </nav>

      <div class="flex-1 overflow-y-auto p-4">
        <div v-if="loadingProducts" class="text-sm text-muted/70">Cargando...</div>
        <div
          v-else
          class="grid gap-3"
          :class="theme.layout.catalogColumns === 'auto' ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : ''"
          :style="gridColumnsStyle"
        >
          <ProductCard
            v-for="product in products"
            :key="product.id"
            :product="product"
            @select="selectProduct"
          />
        </div>
        <p v-if="!loadingProducts && products.length === 0" class="text-sm text-muted/70 text-center mt-8">
          Sin resultados. Verifica que el catálogo ya se haya sincronizado.
        </p>
      </div>
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
      <div class="bg-surface rounded-xl p-6 w-full max-w-sm">
        <h2 class="text-ink mb-4">Confirmar cobro</h2>
        <p class="text-2xl font-bold text-ink mb-4">${{ cart.total.toFixed(2) }}</p>

        <label class="block text-sm text-ink/80 mb-1">Método de pago</label>
        <select
          v-model="paymentMethod"
          class="w-full mb-4 px-3 py-2 border border-line-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/70"
        >
          <option value="CASH">Efectivo</option>
          <option value="CARD">Tarjeta</option>
          <option value="TRANSFER">Transferencia</option>
          <option value="OTHER">Otro</option>
        </select>

        <p v-if="checkoutError" class="text-sm text-danger mb-3">{{ checkoutError }}</p>

        <div class="flex gap-2">
          <button
            class="flex-1 bg-surface-alt hover:bg-line text-ink/90 font-medium py-2 rounded-lg"
            @click="checkoutOpen = false"
          >
            Cancelar
          </button>
          <button
            class="flex-1 bg-primary hover:bg-primary-hover disabled:opacity-50 text-primary-on font-medium py-2 rounded-lg flex items-center justify-center gap-1.5"
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
      <div class="bg-surface rounded-xl p-6 w-full max-w-sm">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-ink">Cerrar caja</h2>
          <button class="text-muted/70 hover:text-ink/80" @click="closeCashOpen = false">
            <Icon :path="mdiCloseCircleOutline" :size="20" />
          </button>
        </div>

        <div class="bg-page rounded-lg p-3 mb-4 text-sm space-y-1">
          <div class="flex justify-between text-ink/80">
            <span>Monto de apertura</span>
            <span>${{ cashSession ? Number(cashSession.openingAmount).toFixed(2) : "0.00" }}</span>
          </div>
        </div>

        <label class="block text-sm text-ink/80 mb-1">Monto contado en efectivo</label>
        <input
          v-model="closingAmountInput"
          type="number"
          step="0.01"
          class="w-full mb-3 px-3 py-2 border border-line-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/70"
          placeholder="0.00"
        />

        <label class="block text-sm text-ink/80 mb-1">Notas (opcional)</label>
        <textarea
          v-model="closeCashNotes"
          rows="2"
          class="w-full mb-4 px-3 py-2 border border-line-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/70 text-sm"
          placeholder="Observaciones del cierre..."
        />

        <p v-if="closeCashError" class="text-sm text-danger mb-3">{{ closeCashError }}</p>

        <div class="flex gap-2">
          <button
            class="flex-1 bg-surface-alt hover:bg-line text-ink/90 font-medium py-2 rounded-lg"
            @click="closeCashOpen = false"
          >
            Cancelar
          </button>
          <button
            class="flex-1 bg-danger hover:bg-danger-hover disabled:opacity-50 text-danger-on font-medium py-2 rounded-lg"
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
