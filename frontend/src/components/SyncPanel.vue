<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  mdiAccountMultipleOutline,
  mdiCheckCircle,
  mdiClose,
  mdiPackageVariantClosed,
  mdiPaletteOutline,
  mdiRefresh,
  mdiSync,
} from "@mdi/js";
import { api } from "../api/client";
import { onSocketEvent } from "../socket/localSocket";
import Icon from "./Icon.vue";

// Panel de la "ruedita" de sincronización: qué tan al día está esta caja con el CRM (catálogo,
// clientes, usuarios) sin tener que abrir el historial. Sin autenticación (GET /system/sync-summary
// es público, como /system/info): se ve también antes de iniciar sesión, en el login y el emparejamiento.
defineProps<{ below?: boolean }>();
const emit = defineEmits<{ close: [] }>();

interface SyncLogInfo {
  status: "SUCCESS" | "ERROR";
  message: string | null;
  createdAt: string;
}

interface SyncSummary {
  lastPull: SyncLogInfo | null;
  lastPush: SyncLogInfo | null;
  pendingSales: number;
  counts: { products: number; categories: number; customers: number; users: number };
  theme: { name: string | null; source: string } | null;
}

const summary = ref<SyncSummary | null>(null);
const loading = ref(true);
const syncing = ref(false);
const error = ref<string | null>(null);

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    summary.value = await api.get<SyncSummary>("/system/sync-summary");
  } catch {
    error.value = "No se pudo leer el estado de sincronización";
  } finally {
    loading.value = false;
  }
}

async function syncNow(): Promise<void> {
  syncing.value = true;
  try {
    await api.post("/sync/run");
  } catch {
    // Sin sesión de cajero /sync/run (autenticado) puede fallar; el ciclo en segundo
    // plano sigue corriendo solo cada pocos minutos, así que no es grave.
  } finally {
    await refresh();
    syncing.value = false;
  }
}

// El backend avisa por el socket local tras cada ciclo de sync (venga del cron, de un evento del
// CRM o de este mismo botón): con el panel abierto se refresca sin que el cajero tenga que tocar nada.
const offSync = onSocketEvent("sync.status", () => void refresh());

onMounted(() => void refresh());
onUnmounted(() => offSync());

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

const pullOk = computed(() => summary.value?.lastPull?.status === "SUCCESS");
const pushOk = computed(() => summary.value?.lastPush?.status !== "ERROR"); // null = sin ventas que enviar todavía, no es error
const themeLabel = computed(() => summary.value?.theme?.name ?? "Integrado (POS KIOSKO)");
</script>

<template>
  <!-- Con la barra arriba (tema) el panel se abre hacia abajo; con la barra abajo, hacia arriba. -->
  <div
    class="absolute right-3 w-72 flex flex-col rounded-md border border-line bg-surface text-ink/90 shadow-lg text-xs"
    :class="below ? 'top-full mt-1' : 'bottom-full mb-1'"
  >
    <div class="flex items-center justify-between px-3 py-2 border-b border-line">
      <span class="font-medium flex items-center gap-1.5">
        <Icon :path="mdiSync" :size="14" />
        Sincronización
      </span>
      <div class="flex items-center gap-2">
        <button type="button" title="Sincronizar ahora" class="hover:text-ink" :disabled="syncing" @click="syncNow">
          <Icon :path="mdiRefresh" :size="15" :class="syncing ? 'animate-spin' : ''" />
        </button>
        <button type="button" title="Cerrar" class="hover:text-ink" @click="emit('close')">
          <Icon :path="mdiClose" :size="15" />
        </button>
      </div>
    </div>

    <div v-if="loading && !summary" class="p-3 text-muted">Cargando...</div>
    <p v-else-if="error && !summary" class="p-3 text-danger">{{ error }}</p>

    <div v-else-if="summary" class="p-3 flex flex-col gap-2.5">
      <div class="flex items-center justify-between">
        <span class="flex items-center gap-1.5 text-muted">
          <Icon :path="mdiPackageVariantClosed" :size="14" />
          Catálogo
        </span>
        <span>{{ summary.counts.products }} productos · {{ summary.counts.categories }} categorías</span>
      </div>

      <div class="flex items-center justify-between">
        <span class="flex items-center gap-1.5 text-muted">
          <Icon :path="mdiAccountMultipleOutline" :size="14" />
          Clientes y usuarios
        </span>
        <span>{{ summary.counts.customers }} clientes · {{ summary.counts.users }} usuarios</span>
      </div>

      <div class="flex items-center justify-between">
        <span class="flex items-center gap-1.5 text-muted">
          <Icon :path="mdiPaletteOutline" :size="14" />
          Tema visual
        </span>
        <span class="truncate max-w-[9rem]" :title="themeLabel">{{ themeLabel }}</span>
      </div>

      <div class="border-t border-line pt-2.5 flex flex-col gap-1.5">
        <div class="flex items-center justify-between">
          <span class="text-muted">Última bajada del CRM</span>
          <span class="flex items-center gap-1" :class="pullOk ? 'text-success' : 'text-danger'">
            <Icon :path="mdiCheckCircle" :size="12" />
            {{ timeAgo(summary.lastPull?.createdAt) }}
          </span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted">Último envío de ventas</span>
          <span class="flex items-center gap-1" :class="pushOk ? 'text-success' : 'text-danger'">
            <Icon :path="mdiCheckCircle" :size="12" />
            {{ timeAgo(summary.lastPush?.createdAt) }}
          </span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted">Ventas pendientes de enviar</span>
          <span :class="summary.pendingSales > 0 ? 'text-warning font-medium' : 'text-success'">
            {{ summary.pendingSales }}
          </span>
        </div>
      </div>

      <p v-if="summary.lastPull?.status === 'ERROR' && summary.lastPull.message" class="text-danger text-[11px] border-t border-line pt-2">
        {{ summary.lastPull.message }}
      </p>
    </div>
  </div>
</template>
