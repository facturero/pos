<script setup lang="ts">
import { ref, watch, computed } from "vue";
import type { Product } from "../stores/cart";
import { productImageUrl } from "../api/client";
import { usePreferencesStore } from "../stores/preferences";
import { useThemeStore } from "../stores/theme";
import Icon from "./Icon.vue";
import { mdiImageOutline } from "@mdi/js";

const props = defineProps<{ product: Product }>();
const emit = defineEmits<{ select: [product: Product] }>();

const preferences = usePreferencesStore();
const theme = useThemeStore();

// Con imágenes activadas, todas las tarjetas ocupan el mismo alto: si el producto no tiene
// foto (o todavía no se descargó) muestra un icono, para que la cuadrícula no quede desigual.
const imageFailed = ref(false);
watch(() => props.product.imageFileId, () => (imageFailed.value = false));
const imageSrc = computed(() =>
  props.product.imageFileId && !imageFailed.value ? productImageUrl(props.product.imageFileId) : null,
);

// Variante de la tarjeta (tema: layout.productCard):
//  - image-top:  foto arriba, nombre y precio debajo (la de siempre)
//  - image-left: foto a la izquierda, nombre y precio a la derecha
//  - text-only:  sin foto, aunque el cajero las tenga activadas
//  - compact:    foto pequeña a la izquierda y una sola línea de alto
const variant = computed(() => theme.layout.productCard);
const showImage = computed(() => preferences.showImages && variant.value !== "text-only");
const horizontal = computed(() => variant.value === "image-left" || variant.value === "compact");
</script>

<template>
  <button
    class="text-left h-full bg-surface border border-line rounded-lg hover:border-primary/60 hover:shadow-sm transition flex overflow-hidden"
    :class="horizontal ? 'flex-row items-stretch' : 'flex-col'"
    @click="emit('select', product)"
  >
    <div
      v-if="showImage"
      class="bg-page flex items-center justify-center shrink-0"
      :class="{
        'aspect-[4/3] w-full': !horizontal,
        'w-24 self-stretch': variant === 'image-left',
        'w-14 self-stretch': variant === 'compact',
      }"
    >
      <img
        v-if="imageSrc"
        :src="imageSrc"
        :alt="product.name"
        loading="lazy"
        class="w-full h-full object-cover"
        @error="imageFailed = true"
      />
      <Icon v-else :path="mdiImageOutline" :size="variant === 'compact' ? 20 : 28" class="text-muted/50" />
    </div>
    <div class="flex flex-col gap-1 min-w-0" :class="variant === 'compact' ? 'p-2 justify-center' : 'p-3'">
      <!-- Alto fijo de 2 líneas: así todas las tarjetas miden lo mismo, con o sin imagen y con nombres cortos o largos -->
      <span
        class="font-medium text-ink text-sm leading-tight line-clamp-2"
        :class="variant === 'compact' ? '' : 'min-h-[2.5em]'"
        :title="product.name"
      >{{ product.name }}</span>
      <span class="text-primary font-semibold">${{ Number(product.price).toFixed(2) }}</span>
    </div>
  </button>
</template>
