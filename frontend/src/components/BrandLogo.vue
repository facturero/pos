<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
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

// Centrado óptico de "POS" y de "KIOSKO". Con una caja de línea simétrica el texto NO queda centrado: el hueco
// de una línea se reparte según las métricas de la tipografía (ascent/descent), y las mayúsculas no tienen
// descendentes, así que según la fuente quedan altas o bajas (medido en el kiosco el 2026-10-05: "POS" con
// 3 px de margen arriba y 12 abajo, y "KIOSKO" unos px más arriba que "POS" porque solo se había corregido
// una de las dos palabras). Se mide con canvas dónde cae la tinta de cada palabra en una línea de alto 1em y
// se corrige con un desplazamiento en em: las dos quedan centradas en la misma línea, con cualquier fuente.
const chipText = ref<HTMLElement | null>(null);
const wordText = ref<HTMLElement | null>(null);
const chipShiftEm = ref(0);
const wordShiftEm = ref(0);

function inkShiftEm(el: HTMLElement | null, text: string): number | null {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!el || !ctx) return null;
  const cs = getComputedStyle(el);
  const size = parseFloat(cs.fontSize);
  if (!size) return null;
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const m = ctx.measureText(text);
  if (!m.fontBoundingBoxAscent && !m.fontBoundingBoxDescent) return null;
  const baseline = (size - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
  const inkCenter = baseline + (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2;
  return (size / 2 - inkCenter) / size;
}

function measureInk(): void {
  chipShiftEm.value = inkShiftEm(chipText.value, "POS") ?? chipShiftEm.value;
  wordShiftEm.value = inkShiftEm(wordText.value, "KIOSKO") ?? wordShiftEm.value;
}

onMounted(() => {
  measureInk();
  // la fuente del tema puede terminar de cargar después de montar: se vuelve a medir
  void document.fonts?.ready.then(measureInk);
});
watch([px, showImage], () => void nextTick(measureInk));
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
      <span class="bg-primary text-primary-on rounded-[0.08em] px-[0.2em] py-[0.14em] tracking-normal">
        <span ref="chipText" class="block" :style="{ transform: `translateY(${chipShiftEm}em)` }">POS</span>
      </span>
      <span ref="wordText" class="text-ink ml-[0.28em]" :style="{ transform: `translateY(${wordShiftEm}em)` }">KIOSKO</span>
    </span>
    <span v-if="byline" class="mt-1 text-xs italic text-muted">un producto de noahsolutions</span>
  </span>
</template>
