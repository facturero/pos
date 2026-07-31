<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api } from "../api/client";
import { useSyncStore } from "../stores/sync";

interface SaleItem {
  id: number;
  quantity: string;
  unitPrice: string;
  subtotal: string;
  product: { name: string };
}

interface Sale {
  id: number;
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
const sync = useSyncStore();

async function loadSales() {
  loading.value = true;
  try {
    sales.value = await api.get<Sale[]>("/sales");
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
      <h1 class="text-lg font-semibold text-gray-800">Historial de ventas</h1>
      <button
        class="text-sm text-brand-600 hover:text-brand-700"
        @click="sync.forceSyncNow()"
      >
        Sincronizar ahora
      </button>
    </div>

    <div v-if="loading" class="text-sm text-gray-400">Cargando...</div>

    <div v-else class="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
      <div v-for="sale in sales" :key="sale.id">
        <button
          class="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
          @click="toggleExpand(sale.id)"
        >
          <div>
            <p class="text-sm font-medium text-gray-800">
              Venta #{{ sale.id }}
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
              class="text-xs text-red-600 hover:text-red-700"
              @click.stop="voidSale(sale.id)"
            >
              Anular
            </button>
          </div>
        </button>

        <div v-if="expandedId === sale.id" class="px-4 pb-3 text-sm text-gray-600 space-y-1">
          <div v-for="item in sale.items" :key="item.id" class="flex justify-between">
            <span>{{ item.quantity }}x {{ item.product.name }}</span>
            <span>${{ Number(item.subtotal).toFixed(2) }}</span>
          </div>
        </div>
      </div>

      <p v-if="sales.length === 0" class="px-4 py-8 text-center text-sm text-gray-400">
        Todavía no hay ventas registradas.
      </p>
    </div>
  </div>
</template>
