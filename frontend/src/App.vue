<script setup lang="ts">
import { onMounted, onUnmounted, computed, watch } from "vue";
import { useRouter } from "vue-router";
import { mdiStorefront, mdiHistory, mdiLogout, mdiCloudCheckOutline, mdiCloudSyncOutline, mdiCloudOffOutline } from "@mdi/js";
import { useAuthStore } from "./stores/auth";
import { useSyncStore } from "./stores/sync";
import { useSetupStore } from "./stores/setup";
import Icon from "./components/Icon.vue";
import StatusBar from "./components/StatusBar.vue";
import BrandLogo from "./components/BrandLogo.vue";
import { useThemeStore } from "./stores/theme";

const auth = useAuthStore();
const sync = useSyncStore();
const setup = useSetupStore();
const theme = useThemeStore();
const router = useRouter();

// F12 abre el inspector de la webview (pestaña Red incluida): así se puede diagnosticar el equipo desde su
// propia pantalla, sin SSH ni un navegador aparte. El comando vive en el lado nativo (main.rs, feature
// "devtools" de Tauri); fuera de Tauri (navegador de desarrollo) `invoke` no existe y se ignora en silencio.
async function handleGlobalKeydown(e: KeyboardEvent): Promise<void> {
  if (e.key !== "F12") return;
  e.preventDefault();
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_devtools");
  } catch {
    // no estamos dentro de la webview de Tauri (p. ej. `npm run dev` en un navegador): nada que abrir
  }
}

onMounted(() => {
  // primero, para que un fallo en lo de abajo no impida registrar el listener del teclado
  window.addEventListener("keydown", handleGlobalKeydown);
  theme.start();
  auth.restoreSession();
  setup.startUnlinkListener();
  sync.startSyncListener();
});

onUnmounted(() => {
  theme.stop();
  setup.stopUnlinkListener();
  sync.stopSyncListener();
  window.removeEventListener("keydown", handleGlobalKeydown);
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
  <div class="h-full flex flex-col bg-page">
    <header
      v-if="auth.isAuthenticated"
      class="flex items-center justify-between px-4 py-2 bg-surface border-b border-line shrink-0"
      :class="theme.branding.logoPosition === 'right' ? 'flex-row-reverse' : ''"
    >
      <div class="flex items-center gap-3">
        <BrandLogo />
        <span
          class="text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
          :class="sync.pendingSales > 0
            ? 'bg-warning-soft text-warning'
            : sync.isOnline
              ? 'bg-success-soft text-success'
              : 'bg-surface-alt text-muted'"
        >
          <Icon :path="syncIcon" :size="14" />
          {{ syncLabel }}
        </span>
        <span v-if="theme.branding.welcomeMessage" class="hidden lg:inline text-sm text-muted truncate max-w-xs">
          {{ theme.branding.welcomeMessage }}
        </span>
      </div>
      <div class="flex items-center gap-4 text-sm">
        <router-link to="/" class="text-ink/80 hover:text-primary flex items-center gap-1">
          <Icon :path="mdiStorefront" :size="16" /> Vender
        </router-link>
        <router-link to="/history" class="text-ink/80 hover:text-primary flex items-center gap-1">
          <Icon :path="mdiHistory" :size="16" /> Historial
        </router-link>
        <span class="text-muted/70">|</span>
        <span class="text-ink/90">{{ auth.user?.name }}</span>
        <button class="text-danger hover:text-danger-hover flex items-center gap-1" @click="handleLogout">
          <Icon :path="mdiLogout" :size="16" /> Salir
        </button>
      </div>
    </header>

    <main class="flex-1 min-h-0">
      <router-view />
    </main>

    <StatusBar />
  </div>
</template>
