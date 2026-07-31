<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const username = ref("");
const password = ref("");
const auth = useAuthStore();
const router = useRouter();

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
    </form>
  </div>
</template>
