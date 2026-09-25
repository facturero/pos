<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api } from "../api/client";
import Icon from "../components/Icon.vue";
import { mdiHistory, mdiTrashCanOutline } from "@mdi/js";

interface SaleItem {
  id: number;
  quantity: string;
  unitPrice: string;
  subtotal: string; // base sin IVA, ya descontada
  taxAmount: string; // IVA de la línea
  product: { name: string };
}

interface Sale {
  id: number;
  subtotal: string;
  tax: string;
  total: string;
  paymentMethod: string;
  status: "COMPLETED" | "VOIDED";
  synced: boolean;
  createdAt: string;
  user: { name: string };
  items: SaleItem[];
}

const sales = ref<Sale[]>([]);
const loading = ref(true);
const expandedId = ref<number | null>(null);

// El historial de la caja solo muestra los últimos 3 días (hoy incluido); lo anterior se consulta en el CRM.
const HISTORY_DAYS = 3;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(key: string): string {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (key === dayKey(today)) return "Hoy";
  if (key === dayKey(yesterday)) return "Ayer";
  const [y, m, d] = key.split("-").map(Number);
  const text = new Date(y, m - 1, d).toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Ventas agrupadas por día (ya vienen de la más reciente a la más antigua).
const groups = computed(() => {
  const byDay = new Map<string, Sale[]>();
  for (const sale of sales.value) {
    const key = dayKey(new Date(sale.createdAt));
    const list = byDay.get(key);
    if (list) list.push(sale);
    else byDay.set(key, [sale]);
  }
  return [...byDay.entries()].map(([key, list]) => ({ key, label: dayLabel(key), sales: list }));
});

async function loadSales() {
  loading.value = true;
  try {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (HISTORY_DAYS - 1));
    sales.value = await api.get<Sale[]>(`/sales?from=${encodeURIComponent(from.toISOString())}`);
  } finally {
    loading.value = false;
  }
}

async function voidSale(id: number) {
  if (!confirm("¿Anular esta venta? Se repondrá el stock.")) return;
  await api.post(`/sales/${id}/void`);
  await loadSales();
}

function toggleExpand(id: number) {
  expandedId.value = expandedId.value === id ? null : id;
}

onMounted(loadSales);
</script>

<template>
  <div class="h-full overflow-y-auto p-4">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-lg font-semibold text-gray-800 flex items-center gap-1.5">
        <Icon :path="mdiHistory" :size="18" class="text-brand-600" />
        Historial de ventas
      </h1>
    </div>

    <div v-if="loading" class="text-sm text-gray-400">Cargando...</div>

    <div v-else class="space-y-4">
     <section v-for="group in groups" :key="group.key">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 px-1">{{ group.label }}</h2>
      <div class="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
      <div v-for="(sale, index) in group.sales" :key="sale.id">
        <button
          class="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
          @click="toggleExpand(sale.id)"
        >
          <div>
            <p class="text-sm font-medium text-gray-800">
              Venta #{{ group.sales.length - index }}
              <span
                v-if="sale.status === 'VOIDED'"
                class="ml-2 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600"
              >
                Anulada
              </span>
              <span
                v-else-if="!sale.synced"
                class="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"
              >
                Pendiente de sync
              </span>
            </p>
            <p class="text-xs text-gray-400">
              {{ new Date(sale.createdAt).toLocaleString() }} · {{ sale.user.name }}
            </p>
          </div>
          <div class="flex items-center gap-3">
            <span class="font-semibold text-gray-800">${{ Number(sale.total).toFixed(2) }}</span>
            <button
              v-if="sale.status === 'COMPLETED'"
              class="text-xs text-red-600 hover:text-red-700 flex items-center gap-1"
              @click.stop="voidSale(sale.id)"
            >
              <Icon :path="mdiTrashCanOutline" :size="14" />
              Anular
            </button>
          </div>
        </button>

        <div v-if="expandedId === sale.id" class="px-4 pb-3 text-sm text-gray-600 space-y-1">
          <div v-for="item in sale.items" :key="item.id" class="flex justify-between">
            <span>{{ item.quantity }}x {{ item.product.name }}</span>
            <span>${{ (Number(item.subtotal) + Number(item.taxAmount)).toFixed(2) }}</span>
          </div>
          <div class="flex justify-between text-xs text-gray-400 pt-1 border-t border-gray-100">
            <span>Subtotal (sin IVA)</span>
            <span>${{ Number(sale.subtotal).toFixed(2) }}</span>
          </div>
          <div class="flex justify-between text-xs text-gray-400">
            <span>IVA</span>
            <span>${{ Number(sale.tax).toFixed(2) }}</span>
          </div>
        </div>
      </div>
      </div>
     </section>

      <p v-if="sales.length === 0" class="px-4 py-8 text-center text-sm text-gray-400">
        No hay ventas en los últimos 3 días. El historial completo está en el CRM.
      </p>
    </div>
  </div>
</template>
