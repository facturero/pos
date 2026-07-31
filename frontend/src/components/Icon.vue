<script setup lang="ts">
// Wrapper genérico para iconos MDI (@mdi/js). Recibe el path (string SVG)
// y lo pinta inline — nada de webfont ni sprite sheet, así que el bundle
// final solo pesa lo que realmente se usa (tree-shaking por import).
withDefaults(
  defineProps<{
    path: string;
    size?: number; // en píxeles
  }>(),
  { size: 20 }
);
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    class="shrink-0 fill-current"
  >
    <path :d="path" />
  </svg>
</template>
