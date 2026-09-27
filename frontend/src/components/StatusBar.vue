<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { mdiClockOutline, mdiEthernet, mdiHelpNetworkOutline, mdiLanDisconnect, mdiPower, mdiRestart, mdiWifi } from "@mdi/js";
import { api, ApiError } from "../api/client";
import Icon from "./Icon.vue";
import WifiPanel from "./WifiPanel.vue";

// Barra de estado inferior, como el "system bar" de Material: versión instalada, por dónde sale el equipo a la
// red (cable / Wi-Fi / sin red) y la hora. La versión y la red las lee el backend local (/system/info: el
// navegador no distingue cable de Wi-Fi); la hora es la del equipo.

interface SystemInfo {
  version: string | null;
  network: { type: "ethernet" | "wifi" | "none" | "unknown"; iface: string | null };
}

const NETWORK_REFRESH_MS = 10_000;
const info = ref<SystemInfo | null>(null);
const now = ref(new Date());
let netTimer: ReturnType<typeof setInterval> | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;

async function refreshInfo(): Promise<void> {
  try {
    info.value = await api.get<SystemInfo>("/system/info");
  } catch {
    // el servicio local no responde: la barra conserva lo último que supo
  }
}

const time = computed(() => now.value.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" }));
const versionLabel = computed(() => (info.value ? (info.value.version ? `v${info.value.version}` : "desarrollo") : ""));

const net = computed(() => {
  switch (info.value?.network.type) {
    case "ethernet":
      return { icon: mdiEthernet, label: "Cable", tone: "text-emerald-600" };
    case "wifi":
      return { icon: mdiWifi, label: "Wi-Fi", tone: "text-emerald-600" };
    case "none":
      return { icon: mdiLanDisconnect, label: "Sin red", tone: "text-red-600" };
    default:
      return { icon: mdiHelpNetworkOutline, label: "Red desconocida", tone: "text-gray-400" };
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
// botón de encendido — esto solo evita que sea por accidente (confirm()). Sin pantalla de "apagando...":
// si funciona, la pantalla se apaga sola; si falla (typ. desarrollo o sudoers mal puesto), se ve el error.
const powerBusy = ref(false);
const powerError = ref<string | null>(null);

async function doPower(action: "poweroff" | "reboot"): Promise<void> {
  const question = action === "poweroff" ? "¿Apagar el equipo?" : "¿Reiniciar el equipo?";
  if (!confirm(question)) return;
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

const showWifi = ref(false);
</script>

<template>
  <footer
    class="relative flex items-center justify-between h-6 px-3 shrink-0 bg-gray-100 border-t border-gray-200 text-xs text-gray-500"
  >
    <WifiPanel v-if="showWifi" @close="showWifi = false" />

    <span>{{ versionLabel }}</span>
    <div class="flex items-center gap-4">
      <span v-if="powerError" class="text-red-600">{{ powerError }}</span>
      <button
        type="button"
        class="flex items-center gap-1 hover:text-gray-800"
        :class="net.tone"
        @click="showWifi = !showWifi"
      >
        <Icon :path="net.icon" :size="14" />
        {{ net.label }}
      </button>
      <span class="flex items-center gap-1">
        <Icon :path="mdiClockOutline" :size="14" />
        {{ time }}
      </span>
      <button
        type="button"
        title="Reiniciar el equipo"
        class="hover:text-gray-800 disabled:opacity-40"
        :disabled="powerBusy"
        @click="doPower('reboot')"
      >
        <Icon :path="mdiRestart" :size="14" />
      </button>
      <button
        type="button"
        title="Apagar el equipo"
        class="hover:text-red-600 disabled:opacity-40"
        :disabled="powerBusy"
        @click="doPower('poweroff')"
      >
        <Icon :path="mdiPower" :size="14" />
      </button>
    </div>
  </footer>
</template>
