<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { mdiClose, mdiLock, mdiLockOpenVariant, mdiRefresh, mdiWifiStrength1, mdiWifiStrength2, mdiWifiStrength3, mdiWifiStrength4 } from "@mdi/js";
import { api, ApiError } from "../api/client";
import Icon from "./Icon.vue";

// Panel de Wi-Fi de la barra de estado: se abre haciendo clic en "Cable"/"Wi-Fi"/"Sin red". Lista redes,
// y si una está protegida pide la clave antes de conectar. Nada de esto se prueba con una tarjeta Wi-Fi
// real (ver backend/src/system/wifi.ts): en VirtualBox no hay ninguna que escanear.

defineProps<{ below?: boolean }>();
const emit = defineEmits<{ close: [] }>();

interface WifiNetwork {
  ssid: string;
  signal: number;
  secured: boolean;
  active: boolean;
}

const networks = ref<WifiNetwork[]>([]);
const loading = ref(false);
const listError = ref<string | null>(null);

const connecting = ref<string | null>(null); // ssid en curso
const connectError = ref<string | null>(null);
const passwordFor = ref<string | null>(null); // ssid que está pidiendo clave
const password = ref("");

async function refresh(): Promise<void> {
  loading.value = true;
  listError.value = null;
  try {
    networks.value = await api.get<WifiNetwork[]>("/system/wifi/networks");
  } catch (err) {
    listError.value = err instanceof ApiError ? err.message : "No se pudo escanear redes Wi-Fi";
  } finally {
    loading.value = false;
  }
}

function signalIcon(signal: number): string {
  if (signal >= 75) return mdiWifiStrength4;
  if (signal >= 50) return mdiWifiStrength3;
  if (signal >= 25) return mdiWifiStrength2;
  return mdiWifiStrength1;
}

function pick(net: WifiNetwork): void {
  connectError.value = null;
  if (net.secured && !net.active) {
    passwordFor.value = net.ssid;
    password.value = "";
    return;
  }
  void doConnect(net.ssid);
}

async function doConnect(ssid: string, pass?: string): Promise<void> {
  connecting.value = ssid;
  connectError.value = null;
  try {
    await api.post("/system/wifi/connect", pass ? { ssid, password: pass } : { ssid });
    passwordFor.value = null;
    await refresh();
  } catch (err) {
    connectError.value = err instanceof ApiError ? err.message : "No se pudo conectar";
  } finally {
    connecting.value = null;
  }
}

const passwordTarget = computed(() => networks.value.find((n) => n.ssid === passwordFor.value) ?? null);

onMounted(() => void refresh());
</script>

<template>
  <!-- Con la barra arriba (tema) el panel se abre hacia abajo; con la barra abajo, hacia arriba. -->
  <div
    class="absolute left-3 w-72 max-h-80 flex flex-col rounded-md border border-line bg-surface text-ink/90 shadow-lg text-xs"
    :class="below ? 'top-full mt-1' : 'bottom-full mb-1'"
  >
    <div class="flex items-center justify-between px-3 py-2 border-b border-line">
      <span class="font-medium">Redes Wi-Fi</span>
      <div class="flex items-center gap-2">
        <button type="button" title="Volver a escanear" class="hover:text-ink" @click="refresh">
          <Icon :path="mdiRefresh" :size="15" />
        </button>
        <button type="button" title="Cerrar" class="hover:text-ink" @click="emit('close')">
          <Icon :path="mdiClose" :size="15" />
        </button>
      </div>
    </div>

    <div v-if="passwordTarget" class="p-3 flex flex-col gap-2">
      <p class="text-ink/80">Contraseña de "{{ passwordTarget.ssid }}"</p>
      <input
        v-model="password"
        type="password"
        autofocus
        class="border border-line-strong rounded px-2 py-1 text-xs"
        @keydown.enter="doConnect(passwordTarget.ssid, password)"
      />
      <p v-if="connectError" class="text-danger">{{ connectError }}</p>
      <div class="flex justify-end gap-2 mt-1">
        <button type="button" class="px-2 py-1 text-muted hover:text-ink" @click="passwordFor = null">Cancelar</button>
        <button
          type="button"
          class="px-2 py-1 rounded bg-primary text-primary-on disabled:opacity-50"
          :disabled="connecting === passwordTarget.ssid || !password"
          @click="doConnect(passwordTarget.ssid, password)"
        >
          {{ connecting === passwordTarget.ssid ? "Conectando…" : "Conectar" }}
        </button>
      </div>
    </div>

    <div v-else class="overflow-y-auto flex-1">
      <p v-if="loading" class="p-3 text-muted">Buscando redes…</p>
      <p v-else-if="listError" class="p-3 text-danger">{{ listError }}</p>
      <p v-else-if="networks.length === 0" class="p-3 text-muted">No se encontró ninguna red.</p>
      <button
        v-for="net in networks"
        :key="net.ssid"
        type="button"
        class="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-page disabled:opacity-50"
        :disabled="connecting === net.ssid"
        @click="pick(net)"
      >
        <Icon :path="signalIcon(net.signal)" :size="15" :class="net.active ? 'text-success' : 'text-muted'" />
        <span class="flex-1 text-left truncate" :class="net.active ? 'font-medium text-success' : ''">
          {{ net.ssid }}{{ net.active ? " (conectado)" : "" }}
        </span>
        <Icon :path="net.secured ? mdiLock : mdiLockOpenVariant" :size="13" class="text-muted/70" />
        <span v-if="connecting === net.ssid" class="text-muted">…</span>
      </button>
      <p v-if="connectError && !passwordTarget" class="p-3 text-danger">{{ connectError }}</p>
    </div>
  </div>
</template>
