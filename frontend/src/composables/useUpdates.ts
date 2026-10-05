import { onMounted, onUnmounted, ref } from "vue";
import { api } from "../api/client";
import { useCartStore } from "../stores/cart";

// Lado pantalla de la actualización "al estilo Discord" (backend/src/system/update.ts): la versión nueva se
// descarga sola en segundo plano y se aplica cuando no estorba. Esta pantalla hace dos cosas:
//  - da el latido (carrito + tiempo sin tocar nada) para que el backend sepa si es buen momento;
//  - muestra si hay una actualización esperando y permite adelantarla con "Actualizar ahora".
export interface PendingUpdate {
  version: string;
  state: "waiting" | "applying";
  reason: string;
}

const TICK_MS = 10_000;

// Módulo, no composable: un solo juego de oyentes aunque se monte varias veces.
let lastInputAt = Date.now();
let listening = false;
function trackInput(): void {
  if (listening) return;
  listening = true;
  for (const ev of ["pointerdown", "keydown", "touchstart", "wheel"]) {
    window.addEventListener(ev, () => (lastInputAt = Date.now()), { passive: true, capture: true });
  }
}

export function useUpdates() {
  const cart = useCartStore();
  const pending = ref<PendingUpdate | null>(null);
  const requesting = ref(false);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function tick(): Promise<void> {
    try {
      await api.post("/system/activity", { cartCount: cart.lines.length, idleMs: Date.now() - lastInputAt });
    } catch {
      // el servicio local no responde: el siguiente latido lo reintenta
    }
    try {
      pending.value = (await api.get<{ pending: PendingUpdate | null }>("/system/update-status")).pending;
    } catch {
      // conserva lo último que supo
    }
  }

  async function updateNow(): Promise<void> {
    requesting.value = true;
    try {
      await api.post("/system/update-now");
      await tick();
    } finally {
      requesting.value = false;
    }
  }

  onMounted(() => {
    trackInput();
    void tick();
    timer = setInterval(() => void tick(), TICK_MS);
  });
  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return { pending, requesting, updateNow };
}
