<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { useSetupStore } from "../stores/setup";
import { ApiError } from "../api/client";

const username = ref("");
const password = ref("");
const auth = useAuthStore();
const router = useRouter();
const setup = useSetupStore();

// "Volver a ingresar el código": por si se emparejó con un código equivocado. Pide confirmación (no debe
// pasar por accidente) y el backend lo rechaza si hay ventas sin enviar.
const confirmingUnpair = ref(false);
const unpairError = ref<string | null>(null);
const unpairing = ref(false);

async function unpair() {
  unpairing.value = true;
  unpairError.value = null;
  try {
    await setup.forget();
    router.push({ name: "setup" });
  } catch (err) {
    unpairError.value = err instanceof ApiError ? err.message : "No se pudo volver a la pantalla del código";
    confirmingUnpair.value = false;
  } finally {
    unpairing.value = false;
  }
}

async function handleSubmit() {
  try {
    await auth.login(username.value, password.value);
    router.push({ name: "pos" });
  } catch {
    // el error ya queda en auth.error para mostrarse en la plantilla
  }
}
</script>

<template>
  <div class="h-full flex items-center justify-center">
    <form
      class="bg-white shadow-sm rounded-xl p-8 w-full max-w-sm border border-gray-200"
      @submit.prevent="handleSubmit"
    >
      <h1 class="text-xl font-semibold text-gray-800 mb-6 text-center">Iniciar sesión</h1>

      <label class="block text-sm text-gray-600 mb-1">Usuario</label>
      <input
        v-model="username"
        type="text"
        autofocus
        class="w-full mb-4 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
      />

      <label class="block text-sm text-gray-600 mb-1">Contraseña</label>
      <input
        v-model="password"
        type="password"
        class="w-full mb-6 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
      />

      <p v-if="auth.error" class="text-sm text-red-600 mb-4">{{ auth.error }}</p>

      <button
        type="submit"
        :disabled="auth.loading"
        class="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition"
      >
        {{ auth.loading ? "Ingresando..." : "Ingresar" }}
      </button>

      <div class="mt-6 pt-4 border-t border-gray-100 text-center">
        <p v-if="unpairError" class="text-sm text-red-600 mb-2" role="alert">{{ unpairError }}</p>
        <button
          v-if="!confirmingUnpair"
          type="button"
          class="text-sm text-gray-500 hover:text-brand-600 underline"
          @click="confirmingUnpair = true"
        >
          ¿Pusiste mal el código? Volver a ingresarlo
        </button>
        <div v-else class="text-sm text-gray-600">
          <p class="mb-3">Este equipo se desvinculará y volverá a pedir el código de 6 dígitos.</p>
          <div class="flex gap-2">
            <button
              type="button"
              class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded-lg"
              @click="confirmingUnpair = false"
            >
              Cancelar
            </button>
            <button
              type="button"
              :disabled="unpairing"
              class="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white py-2 rounded-lg"
              @click="unpair"
            >
              {{ unpairing ? "Volviendo..." : "Sí, volver" }}
            </button>
          </div>
        </div>
      </div>
    </form>
  </div>
</template>
