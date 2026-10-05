<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { mdiClockOutline, mdiCog, mdiEthernet, mdiHelpNetworkOutline, mdiLanDisconnect, mdiPower, mdiRestart, mdiWeatherNight, mdiWeatherSunny, mdiWifi } from "@mdi/js";
import { api, ApiError } from "../api/client";
import { useThemeStore } from "../stores/theme";
import Icon from "./Icon.vue";
import WifiPanel from "./WifiPanel.vue";
import SyncPanel from "./SyncPanel.vue";
import { useUpdates } from "../composables/useUpdates";

// Barra de estado inferior, como el "system bar" de Material: versión instalada, por dónde sale el equipo a la
// red (cable / Wi-Fi / sin red) y la hora. La versión y la red las lee el backend local (/system/info: el
// navegador no distingue cable de Wi-Fi); la hora es la del equipo.

interface SystemInfo {
  version: string | null;
  network: { type: "ethernet" | "wifi" | "none" | "unknown"; iface: string | null };
  mode: "kiosk" | "desktop";
}

const theme = useThemeStore();
const updates = useUpdates();
const confirmUpdate = ref(false);

const NETWORK_REFRESH_MS = 10_000;
const info = ref<SystemInfo | null>(null);
const now = ref(new Date());
let netTimer: ReturnType<typeof setInterval> | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;

// Versión con la que se cargó ESTA pantalla. Si más tarde el backend responde otra (se aplicó una
// actualización), esta pantalla quedó con el index.html y los archivos con hash de la versión anterior:
// se recarga para traer los nuevos. Es la forma de que la ventana se ponga al día aunque el actualizador
// de la caja no la reinicie (los instalados con ISO viejas solo reinician el backend).
let bootVersion: string | null = null;

async function refreshInfo(): Promise<void> {
  try {
    info.value = await api.get<SystemInfo>("/system/info");
    const v = info.value.version;
    if (v) {
      if (bootVersion === null) bootVersion = v;
      else if (v !== bootVersion) window.location.reload();
    }
  } catch {
    // el servicio local no responde: la barra conserva lo último que supo
  }
}

const time = computed(() => now.value.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" }));
const versionLabel = computed(() => (info.value ? (info.value.version ? `v${info.value.version}` : "desarrollo") : ""));
// Antes de que llegue /system/info se asume kiosk (el modo de siempre): así la barra no "parpadea"
// mostrando de más y luego ocultando. En modo desktop (Windows, .exe) Windows ya da su propia hora
// y su propio apagar/reiniciar en la barra de tareas, así que esta barra no los duplica.
const isDesktop = computed(() => info.value?.mode === "desktop");

const net = computed(() => {
  switch (info.value?.network.type) {
    case "ethernet":
      return { icon: mdiEthernet, label: "Cable", tone: "text-success" };
    case "wifi":
      return { icon: mdiWifi, label: "Wi-Fi", tone: "text-success" };
    case "none":
      return { icon: mdiLanDisconnect, label: "Sin red", tone: "text-danger" };
    default:
      return { icon: mdiHelpNetworkOutline, label: "Red desconocida", tone: "text-muted/70" };
  }
});

onMounted(() => {
  void refreshInfo();
  netTimer = setInterval(() => void refreshInfo(), NETWORK_REFRESH_MS);
  clockTimer = setInterval(() => (now.value = new Date()), 15_000);
});

onUnmounted(() => {
  if (netTimer) clearInterval(netTimer);
  if (clockTimer) clearInterval(clockTimer);
});

// Apagar/reiniciar: cualquiera con acceso físico al kiosco ya podría hacerlo tirando del cable o con el
// botón de encendido — este modal solo evita que sea por accidente. Un confirm() nativo se veía como un
// diálogo crudo de navegador ("JavaScript - http://..."), fuera de lugar en una pantalla de kiosco sin
// barra de direcciones a la vista; este modal usa el mismo estilo que el resto de diálogos del POS
// (POSView.vue: tarjeta blanca centrada sobre fondo oscurecido). Sin pantalla de "apagando...": si
// funciona, la pantalla se apaga sola; si falla (typ. desarrollo o sudoers mal puesto), se ve el error.
const powerBusy = ref(false);
const powerError = ref<string | null>(null);
const pendingPower = ref<"poweroff" | "reboot" | null>(null);

function askPower(action: "poweroff" | "reboot"): void {
  powerError.value = null;
  pendingPower.value = action;
}

async function confirmPower(): Promise<void> {
  const action = pendingPower.value;
  if (!action) return;
  pendingPower.value = null;
  powerBusy.value = true;
  powerError.value = null;
  try {
    await api.post(`/system/${action}`);
    // sin then: si el comando funcionó, el equipo se está apagando/reiniciando ya mismo
  } catch (err) {
    powerError.value = err instanceof ApiError ? err.message : "No se pudo completar la acción";
    powerBusy.value = false;
  }
}

// Los dos paneles (Wi-Fi y sincronización) no se muestran a la vez: abrir uno cierra el otro,
// para que no se superpongan sobre una barra tan angosta.
const showWifi = ref(false);
const showSync = ref(false);
function toggleWifi(): void {
  showSync.value = false;
  showWifi.value = !showWifi.value;
}
function toggleSync(): void {
  showWifi.value = false;
  showSync.value = !showSync.value;
}
</script>

<template>
  <!-- La barra se puede poner arriba o abajo (tema), pero NO se puede ocultar: es el control del usuario sobre su equipo. -->
  <footer
    data-compact-exempt
    class="relative flex items-center justify-between h-6 px-3 shrink-0 bg-surface-alt border-line text-xs text-muted"
    :class="theme.layout.statusBarPosition === 'top' ? 'order-first border-b' : 'border-t'"
  >
    <WifiPanel v-if="showWifi" :below="theme.layout.statusBarPosition === 'top'" @close="showWifi = false" />
    <SyncPanel v-if="showSync" :below="theme.layout.statusBarPosition === 'top'" @close="showSync = false" />

    <span>{{ versionLabel }}</span>
    <div v-if="updates.pending.value" class="flex items-center gap-2 text-ink font-medium">
      <template v-if="updates.pending.value.state === 'applying'">
        <span>Actualizando a v{{ updates.pending.value.version }}…</span>
      </template>
      <template v-else>
        <span>Actualización v{{ updates.pending.value.version }} lista · se aplicará sola al cerrar caja o sin actividad</span>
        <button type="button" class="underline hover:text-ink" @click="confirmUpdate = true">Actualizar ahora</button>
      </template>
    </div>
    <div class="flex items-center gap-4">
      <span v-if="powerError" class="text-danger">{{ powerError }}</span>
      <button
        type="button"
        class="flex items-center gap-1 hover:text-ink"
        :class="net.tone"
        @click="toggleWifi"
      >
        <Icon :path="net.icon" :size="14" />
        {{ net.label }}
      </button>
      <button
        type="button"
        title="Sincronización: catálogo, clientes y usuarios"
        class="hover:text-ink"
        @click="toggleSync"
      >
        <Icon :path="mdiCog" :size="14" />
      </button>
      <span v-if="!isDesktop" class="flex items-center gap-1">
        <Icon :path="mdiClockOutline" :size="14" />
        {{ time }}
      </span>
      <button
        v-if="theme.canToggleMode"
        type="button"
        :title="theme.mode === 'dark' ? 'Modo claro' : 'Modo oscuro'"
        class="hover:text-ink"
        @click="theme.toggleMode()"
      >
        <Icon :path="theme.mode === 'dark' ? mdiWeatherSunny : mdiWeatherNight" :size="14" />
      </button>
      <button
        v-if="!isDesktop"
        type="button"
        title="Reiniciar el equipo"
        class="hover:text-ink disabled:opacity-40"
        :disabled="powerBusy"
        @click="askPower('reboot')"
      >
        <Icon :path="mdiRestart" :size="14" />
      </button>
      <button
        v-if="!isDesktop"
        type="button"
        title="Apagar el equipo"
        class="hover:text-danger-hover disabled:opacity-40"
        :disabled="powerBusy"
        @click="askPower('poweroff')"
      >
        <Icon :path="mdiPower" :size="14" />
      </button>
    </div>

    <div
      v-if="confirmUpdate"
      class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 text-sm text-ink/90"
      @click.self="confirmUpdate = false"
    >
      <div class="bg-surface rounded-xl p-6 w-full max-w-sm text-center">
        <h2 class="text-ink text-base mb-1">¿Actualizar ahora?</h2>
        <p class="text-muted mb-5">
          La pantalla se reiniciará unos segundos. Lo que tengas en el carrito se perderá.
        </p>
        <div class="flex gap-2">
          <button
            type="button"
            class="flex-1 py-2 rounded-lg border border-line-strong text-ink/90 hover:bg-page"
            @click="confirmUpdate = false"
          >
            Cancelar
          </button>
          <button
            type="button"
            class="flex-1 py-2 rounded-lg font-medium bg-primary hover:bg-primary-hover text-primary-on disabled:opacity-40"
            :disabled="updates.requesting.value"
            @click="updates.updateNow().finally(() => (confirmUpdate = false))"
          >
            Actualizar
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="pendingPower && !isDesktop"
      class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 text-sm text-ink/90"
      @click.self="pendingPower = null"
    >
      <div class="bg-surface rounded-xl p-6 w-full max-w-sm text-center">
        <Icon
          :path="pendingPower === 'poweroff' ? mdiPower : mdiRestart"
          :size="32"
          :class="pendingPower === 'poweroff' ? 'text-danger' : 'text-ink/90'"
          class="mx-auto mb-3"
        />
        <h2 class="text-ink text-base mb-1">
          {{ pendingPower === "poweroff" ? "¿Apagar el equipo?" : "¿Reiniciar el equipo?" }}
        </h2>
        <p class="text-muted mb-5">Se cerrará todo lo que esté abierto en el POS.</p>
        <div class="flex gap-2">
          <button
            type="button"
            class="flex-1 py-2 rounded-lg border border-line-strong text-ink/90 hover:bg-page"
            @click="pendingPower = null"
          >
            Cancelar
          </button>
          <button
            type="button"
            class="flex-1 py-2 rounded-lg font-medium"
            :class="pendingPower === 'poweroff' ? 'bg-danger hover:bg-danger-hover text-danger-on' : 'bg-primary hover:bg-primary-hover text-primary-on'"
            @click="confirmPower"
          >
            {{ pendingPower === "poweroff" ? "Apagar" : "Reiniciar" }}
          </button>
        </div>
      </div>
    </div>
  </footer>
</template>
