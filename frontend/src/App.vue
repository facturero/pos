<script setup lang="ts">
import { onMounted, onUnmounted, computed } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "./stores/auth";
import { useSyncStore } from "./stores/sync";

const auth = useAuthStore();
const sync = useSyncStore();
const router = useRouter();

onMounted(() => {
  auth.restoreSession();
  sync.startPolling();
});

onUnmounted(() => {
  sync.stopPolling();
});

const syncLabel = computed(() => {
  if (sync.pendingSales > 0) return `${sync.pendingSales} venta(s) por sincronizar`;
  if (sync.isOnline) return "Sincronizado";
  return "Sin conexión con el admin";
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
        <span class="font-semibold text-gray-800">POS</span>
        <span
          class="text-xs px-2 py-0.5 rounded-full"
          :class="sync.pendingSales > 0
            ? 'bg-amber-100 text-amber-700'
            : sync.isOnline
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-gray-100 text-gray-500'"
        >
          {{ syncLabel }}
        </span>
      </div>
      <div class="flex items-center gap-4 text-sm">
        <router-link to="/" class="text-gray-600 hover:text-brand-600">Vender</router-link>
        <router-link to="/history" class="text-gray-600 hover:text-brand-600">Historial</router-link>
        <span class="text-gray-400">|</span>
        <span class="text-gray-700">{{ auth.user?.name }}</span>
        <button class="text-red-600 hover:text-red-700" @click="handleLogout">Salir</button>
      </div>
    </header>

    <main class="flex-1 min-h-0">
      <router-view />
    </main>
  </div>
</template>
