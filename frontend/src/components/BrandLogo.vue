<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useThemeStore } from "../stores/theme";

// La marca de la caja: la imagen de la empresa (si el tema trae una) o, sin ella, el logotipo
// "POS KIOSKO" — el mismo diseño de la pantalla de instalación (chip con "POS" + palabra).
// Sus colores salen de los tokens del tema, así que se adapta al color del cliente y al modo oscuro.
//
// La imagen se dibuja SIEMPRE con <img> (nunca inline ni <object>): un SVG cargado así no ejecuta
// scripts. Si aún no bajó o falla al cargar, se muestra el logotipo: el encabezado nunca queda vacío.
const props = withDefaults(defineProps<{
  /** Alto en px. Sin él, el que pide el tema (`logoSize`). */
  height?: number;
  /** Bajo el logotipo "POS KIOSKO" (no bajo la imagen del cliente): "un producto de noahsolutions". */
  byline?: boolean;
}>(), { height: undefined, byline: false });

const theme = useThemeStore();
const HEIGHTS = { sm: 24, md: 32, lg: 44 } as const;
const px = computed(() => props.height ?? HEIGHTS[theme.branding.logoSize]);

const failed = ref(false);
watch(() => theme.logoUrl, () => (failed.value = false));
const showImage = computed(() => !!theme.logoUrl && !failed.value);
</script>

<template>
  <img
    v-if="showImage"
    :src="theme.logoUrl!"
    alt="Logo"
    class="object-contain"
    :style="{ height: `${px}px`, maxWidth: '200px' }"
    @error="failed = true"
  />
  <span v-else class="inline-flex flex-col items-center">
    <span
      role="img"
      aria-label="POS KIOSKO"
      class="inline-flex items-center font-extrabold leading-none tracking-[0.01em]"
      :style="{ fontSize: `${Math.round(px * 0.75)}px` }"
    >
      <span class="bg-primary text-primary-on rounded-[0.16em] px-[0.22em] pt-[0.06em] pb-[0.1em]">POS</span>
      <span class="text-ink ml-[0.28em]">KIOSKO</span>
    </span>
    <span v-if="byline" class="mt-1 text-xs italic text-muted">un producto de noahsolutions</span>
  </span>
</template>
