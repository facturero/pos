<script setup lang="ts">
import { ref, watch, computed } from "vue";
import type { Product } from "../stores/cart";
import { productImageUrl } from "../api/client";
import { usePreferencesStore } from "../stores/preferences";
import Icon from "./Icon.vue";
import { mdiImageOutline } from "@mdi/js";

const props = defineProps<{ product: Product }>();
const emit = defineEmits<{ select: [product: Product] }>();

const preferences = usePreferencesStore();

// Con imágenes activadas, todas las tarjetas ocupan el mismo alto: si el producto no tiene
// foto (o todavía no se descargó) muestra un icono, para que la cuadrícula no quede desigual.
const imageFailed = ref(false);
watch(() => props.product.imageFileId, () => (imageFailed.value = false));
const imageSrc = computed(() =>
  props.product.imageFileId && !imageFailed.value ? productImageUrl(props.product.imageFileId) : null,
);
</script>

<template>
  <button
    class="text-left h-full bg-white border border-gray-200 rounded-lg hover:border-brand-400 hover:shadow-sm transition flex flex-col overflow-hidden"
    @click="emit('select', product)"
  >
    <div v-if="preferences.showImages" class="aspect-[4/3] w-full bg-gray-50 flex items-center justify-center">
      <img
        v-if="imageSrc"
        :src="imageSrc"
        :alt="product.name"
        loading="lazy"
        class="w-full h-full object-cover"
        @error="imageFailed = true"
      />
      <Icon v-else :path="mdiImageOutline" :size="28" class="text-gray-300" />
    </div>
    <div class="p-3 flex flex-col gap-1">
      <!-- Alto fijo de 2 líneas: así todas las tarjetas miden lo mismo, con o sin imagen y con nombres cortos o largos -->
      <span class="font-medium text-gray-800 text-sm leading-tight line-clamp-2 min-h-[2.5em]" :title="product.name">{{ product.name }}</span>
      <span class="text-brand-600 font-semibold">${{ Number(product.price).toFixed(2) }}</span>
    </div>
  </button>
</template>
