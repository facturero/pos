<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { mdiClockOutline, mdiEthernet, mdiHelpNetworkOutline, mdiLanDisconnect, mdiWifi } from "@mdi/js";
import { api } from "../api/client";
import Icon from "./Icon.vue";

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
</script>

<template>
  <footer
    class="flex items-center justify-between h-6 px-3 shrink-0 bg-gray-100 border-t border-gray-200 text-xs text-gray-500"
  >
    <span>{{ versionLabel }}</span>
    <div class="flex items-center gap-4">
      <span class="flex items-center gap-1" :class="net.tone">
        <Icon :path="net.icon" :size="14" />
        {{ net.label }}
      </span>
      <span class="flex items-center gap-1">
        <Icon :path="mdiClockOutline" :size="14" />
        {{ time }}
      </span>
    </div>
  </footer>
</template>
