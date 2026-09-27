<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { mdiClose, mdiLock, mdiLockOpenVariant, mdiRefresh, mdiWifiStrength1, mdiWifiStrength2, mdiWifiStrength3, mdiWifiStrength4 } from "@mdi/js";
import { api, ApiError } from "../api/client";
import Icon from "./Icon.vue";

// Panel de Wi-Fi de la barra de estado: se abre haciendo clic en "Cable"/"Wi-Fi"/"Sin red". Lista redes,
// y si una está protegida pide la clave antes de conectar. Nada de esto se prueba con una tarjeta Wi-Fi
// real (ver backend/src/system/wifi.ts): en VirtualBox no hay ninguna que escanear.

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
  <div class="absolute bottom-full left-3 mb-1 w-72 max-h-80 flex flex-col rounded-md border border-gray-200 bg-white text-gray-700 shadow-lg text-xs">
    <div class="flex items-center justify-between px-3 py-2 border-b border-gray-200">
      <span class="font-medium">Redes Wi-Fi</span>
      <div class="flex items-center gap-2">
        <button type="button" title="Volver a escanear" class="hover:text-gray-900" @click="refresh">
          <Icon :path="mdiRefresh" :size="15" />
        </button>
        <button type="button" title="Cerrar" class="hover:text-gray-900" @click="emit('close')">
          <Icon :path="mdiClose" :size="15" />
        </button>
      </div>
    </div>

    <div v-if="passwordTarget" class="p-3 flex flex-col gap-2">
      <p class="text-gray-600">Contraseña de "{{ passwordTarget.ssid }}"</p>
      <input
        v-model="password"
        type="password"
        autofocus
        class="border border-gray-300 rounded px-2 py-1 text-xs"
        @keydown.enter="doConnect(passwordTarget.ssid, password)"
      />
      <p v-if="connectError" class="text-red-600">{{ connectError }}</p>
      <div class="flex justify-end gap-2 mt-1">
        <button type="button" class="px-2 py-1 text-gray-500 hover:text-gray-800" @click="passwordFor = null">Cancelar</button>
        <button
          type="button"
          class="px-2 py-1 rounded bg-brand-600 text-white disabled:opacity-50"
          :disabled="connecting === passwordTarget.ssid || !password"
          @click="doConnect(passwordTarget.ssid, password)"
        >
          {{ connecting === passwordTarget.ssid ? "Conectando…" : "Conectar" }}
        </button>
      </div>
    </div>

    <div v-else class="overflow-y-auto flex-1">
      <p v-if="loading" class="p-3 text-gray-500">Buscando redes…</p>
      <p v-else-if="listError" class="p-3 text-red-600">{{ listError }}</p>
      <p v-else-if="networks.length === 0" class="p-3 text-gray-500">No se encontró ninguna red.</p>
      <button
        v-for="net in networks"
        :key="net.ssid"
        type="button"
        class="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
        :disabled="connecting === net.ssid"
        @click="pick(net)"
      >
        <Icon :path="signalIcon(net.signal)" :size="15" :class="net.active ? 'text-emerald-600' : 'text-gray-500'" />
        <span class="flex-1 text-left truncate" :class="net.active ? 'font-medium text-emerald-700' : ''">
          {{ net.ssid }}{{ net.active ? " (conectado)" : "" }}
        </span>
        <Icon :path="net.secured ? mdiLock : mdiLockOpenVariant" :size="13" class="text-gray-400" />
        <span v-if="connecting === net.ssid" class="text-gray-500">…</span>
      </button>
      <p v-if="connectError && !passwordTarget" class="p-3 text-red-600">{{ connectError }}</p>
    </div>
  </div>
</template>
