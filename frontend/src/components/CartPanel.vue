<script setup lang="ts">
import { useCartStore } from "../stores/cart";

const cart = useCartStore();

const emit = defineEmits<{ checkout: [] }>();
</script>

<template>
  <aside class="w-96 shrink-0 bg-white border-l border-gray-200 flex flex-col h-full">
    <div class="p-4 border-b border-gray-200">
      <h2 class="font-semibold text-gray-800">Carrito ({{ cart.itemCount }})</h2>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-3">
      <p v-if="cart.lines.length === 0" class="text-sm text-gray-400 text-center mt-8">
        Agrega productos tocando el catálogo
      </p>

      <div
        v-for="line in cart.lines"
        :key="line.product.id"
        class="flex items-center justify-between gap-2"
      >
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-800 truncate">{{ line.product.name }}</p>
          <p class="text-xs text-gray-400">${{ Number(line.product.price).toFixed(2) }} c/u</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button
            class="w-7 h-7 rounded bg-gray-100 hover:bg-gray-200 text-gray-600"
            @click="cart.setQuantity(line.product.id, line.quantity - 1)"
          >
            −
          </button>
          <span class="w-6 text-center text-sm">{{ line.quantity }}</span>
          <button
            class="w-7 h-7 rounded bg-gray-100 hover:bg-gray-200 text-gray-600"
            @click="cart.setQuantity(line.product.id, line.quantity + 1)"
          >
            +
          </button>
        </div>
      </div>
    </div>

    <div class="p-4 border-t border-gray-200 space-y-2">
      <div class="flex justify-between text-sm text-gray-500">
        <span>Subtotal</span>
        <span>${{ cart.subtotal.toFixed(2) }}</span>
      </div>
      <div class="flex justify-between text-lg font-semibold text-gray-800">
        <span>Total</span>
        <span>${{ cart.total.toFixed(2) }}</span>
      </div>
      <button
        class="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white font-medium py-3 rounded-lg transition mt-2"
        :disabled="cart.lines.length === 0"
        @click="emit('checkout')"
      >
        Cobrar
      </button>
    </div>
  </aside>
</template>
