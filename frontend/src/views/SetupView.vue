<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { mdiCellphoneLink, mdiShieldKeyOutline } from "@mdi/js";
import { useSetupStore } from "../stores/setup";
import Icon from "../components/Icon.vue";
import BrandLogo from "../components/BrandLogo.vue";
import { useThemeStore } from "../stores/theme";

const code = ref("");
const setup = useSetupStore();
const theme = useThemeStore();
const router = useRouter();

async function handleSubmit() {
  if (code.value.length !== 6) return;
  try {
    await setup.pair(code.value);
    router.push({ name: "login" });
  } catch {
    // el error ya queda en setup.error para mostrarse en la plantilla
  }
}

// Solo dígitos, máximo 6 — así el operador no puede escribir letras por error
// mientras lee el código desde la pantalla del CRM.
function handleInput(e: Event) {
  const input = e.target as HTMLInputElement;
  code.value = input.value.replace(/\D/g, "").slice(0, 6);
}
</script>

<template>
  <div class="h-full flex items-center justify-center bg-page" :style="theme.loginBackgroundStyle">
    <form
      class="bg-surface shadow-sm rounded-xl p-8 w-full max-w-sm border border-line"
      @submit.prevent="handleSubmit"
    >
      <div v-if="theme.branding.showLogoOnLogin" class="flex justify-center mb-5">
        <BrandLogo :height="44" byline />
      </div>
      <div class="flex justify-center mb-4">
        <div class="bg-primary-soft rounded-full p-3">
          <Icon :path="mdiCellphoneLink" :size="32" class="text-primary" />
        </div>
      </div>

      <h1 class="text-xl text-ink mb-1 text-center">Configurar este POS</h1>
      <p class="text-sm text-muted mb-6 text-center">
        Ingresa el código de 6 dígitos que ves en el CRM, en
        <span class="font-medium">Establecimientos → Puntos de emisión</span>.
      </p>

      <label class="block text-sm text-ink/80 mb-1 flex items-center gap-1">
        <Icon :path="mdiShieldKeyOutline" :size="16" />
        Código de emparejamiento
      </label>
      <input
        :value="code"
        @input="handleInput"
        type="text"
        inputmode="numeric"
        autofocus
        maxlength="6"
        placeholder="000000"
        class="w-full mb-6 px-3 py-3 text-center text-2xl tracking-[0.5em] font-mono border border-line-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/70"
      />

      <p v-if="setup.error" class="text-sm text-danger mb-4 text-center">{{ setup.error }}</p>

      <button
        type="submit"
        :disabled="setup.loading || code.length !== 6"
        class="w-full bg-primary hover:bg-primary-hover disabled:opacity-50 text-primary-on font-medium py-2 rounded-lg transition"
      >
        {{ setup.loading ? "Emparejando..." : "Emparejar" }}
      </button>

      <p class="text-xs text-muted/70 mt-4 text-center">
        El código cambia cada pocos segundos, como un autenticador — usa el que
        esté visible en este momento.
      </p>
    </form>
  </div>
</template>
