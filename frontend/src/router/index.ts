import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { useSetupStore } from "../stores/setup";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/setup", name: "setup", component: () => import("../views/SetupView.vue") },
    { path: "/login", name: "login", component: () => import("../views/LoginView.vue") },
    {
      path: "/",
      name: "pos",
      component: () => import("../views/POSView.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/history",
      name: "history",
      component: () => import("../views/HistoryView.vue"),
      meta: { requiresAuth: true },
    },
  ],
});

// Orden de guardas: primero el emparejamiento (¿este POS ya sabe a qué
// organización pertenece?), y solo después la sesión normal de cajero.
// Sin emparejar, ni el login tiene sentido — no habría contra qué sincronizar.
router.beforeEach(async (to) => {
  const setup = useSetupStore();
  if (!setup.checked) {
    await setup.checkStatus();
  }

  if (!setup.paired) {
    if (to.name !== "setup") return { name: "setup" };
    return;
  }

  const auth = useAuthStore();

  if (to.name === "setup") {
    return { name: auth.isAuthenticated ? "pos" : "login" };
  }
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: "login" };
  }
  if (to.name === "login" && auth.isAuthenticated) {
    return { name: "pos" };
  }
});

export default router;
