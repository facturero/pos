<script setup lang="ts">
import type { Product } from "../stores/cart";

defineProps<{ product: Product }>();
const emit = defineEmits<{ select: [product: Product] }>();
</script>

<template>
  <button
    class="text-left bg-white border border-gray-200 rounded-lg p-3 hover:border-brand-400 hover:shadow-sm transition flex flex-col gap-1"
    :disabled="Number(product.stock) <= 0"
    :class="{ 'opacity-40 cursor-not-allowed': Number(product.stock) <= 0 }"
    @click="emit('select', product)"
  >
    <span class="font-medium text-gray-800 text-sm leading-tight">{{ product.name }}</span>
    <span class="text-brand-600 font-semibold">${{ Number(product.price).toFixed(2) }}</span>
    <span class="text-xs text-gray-400">Stock: {{ Number(product.stock) }} {{ product.unit }}</span>
  </button>
</template>
