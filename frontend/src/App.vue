<script setup lang="ts">
import { onMounted, onUnmounted, computed, watch } from "vue";
import { useRouter } from "vue-router";
import { mdiStorefront, mdiHistory, mdiLogout, mdiCloudCheckOutline, mdiCloudSyncOutline, mdiCloudOffOutline } from "@mdi/js";
import { useAuthStore } from "./stores/auth";
import { useSyncStore } from "./stores/sync";
import { useSetupStore } from "./stores/setup";
import Icon from "./components/Icon.vue";

const auth = useAuthStore();
const sync = useSyncStore();
const setup = useSetupStore();
const router = useRouter();

onMounted(() => {
  auth.restoreSession();
  setup.startUnlinkListener();
  sync.startSyncListener();
});

onUnmounted(() => {
  setup.stopUnlinkListener();
  sync.stopSyncListener();
});

// Desvinculación remota: el admin presionó "Desvincular y regenerar" en el
// CRM y el backend local ya limpió su par. El evento `unlinked` (socket.io
// local, tiempo real) marca paired:false con reachable:true, así que cerramos
// sesión local y volvemos a la pantalla de emparejamiento.
watch(
  () => setup.paired,
  (paired, wasPaired) => {
    if (!paired && wasPaired && setup.reachable) {
      auth.logout();
      router.push({ name: "setup" });
    }
  },
);

const syncLabel = computed(() => {
  if (sync.pendingSales > 0) return `${sync.pendingSales} venta(s) por sincronizar`;
  if (sync.isOnline) return "Sincronizado";
  return "Sin conexión con el admin";
});

const syncIcon = computed(() => {
  if (sync.pendingSales > 0) return mdiCloudSyncOutline;
  if (sync.isOnline) return mdiCloudCheckOutline;
  return mdiCloudOffOutline;
});

function handleLogout() {
  auth.logout();
  router.push({ name: "login" });
}
</script>

<template>
  <div class="h-full flex flex-col bg-gray-50">
    <header
      v-if="auth.isAuthenticated"
      class="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shrink-0"
    >
      <div class="flex items-center gap-3">
        <span class="font-semibold text-gray-800 flex items-center gap-1.5">
          <Icon :path="mdiStorefront" :size="18" class="text-brand-600" />
          POS
        </span>
        <span
          class="text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
          :class="sync.pendingSales > 0
            ? 'bg-amber-100 text-amber-700'
            : sync.isOnline
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-gray-100 text-gray-500'"
        >
          <Icon :path="syncIcon" :size="14" />
          {{ syncLabel }}
        </span>
      </div>
      <div class="flex items-center gap-4 text-sm">
        <router-link to="/" class="text-gray-600 hover:text-brand-600 flex items-center gap-1">
          <Icon :path="mdiStorefront" :size="16" /> Vender
        </router-link>
        <router-link to="/history" class="text-gray-600 hover:text-brand-600 flex items-center gap-1">
          <Icon :path="mdiHistory" :size="16" /> Historial
        </router-link>
        <span class="text-gray-400">|</span>
        <span class="text-gray-700">{{ auth.user?.name }}</span>
        <button class="text-red-600 hover:text-red-700 flex items-center gap-1" @click="handleLogout">
          <Icon :path="mdiLogout" :size="16" /> Salir
        </button>
      </div>
    </header>

    <main class="flex-1 min-h-0">
      <router-view />
    </main>
  </div>
</template>
