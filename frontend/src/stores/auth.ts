import { defineStore } from "pinia";
import { api, setToken } from "../api/client";

export interface AuthUser {
  id: number;
  name: string;
  username: string;
  role: "ADMIN" | "CASHIER";
}

interface LoginResponse {
  token: string;
  user: AuthUser;
}

export const useAuthStore = defineStore("auth", {
  state: () => ({
    user: null as AuthUser | null,
    loading: false,
    error: null as string | null,
  }),
  getters: {
    isAuthenticated: (state) => !!state.user,
    isAdmin: (state) => state.user?.role === "ADMIN",
  },
  actions: {
    async login(username: string, password: string) {
      this.loading = true;
      this.error = null;
      try {
        const res = await api.post<LoginResponse>("/auth/login", { username, password });
        setToken(res.token);
        this.user = res.user;
        localStorage.setItem("pos_user", JSON.stringify(res.user));
      } catch (err) {
        this.error = err instanceof Error ? err.message : "Error al iniciar sesión";
        throw err;
      } finally {
        this.loading = false;
      }
    },
    logout() {
      setToken(null);
      localStorage.removeItem("pos_user");
      this.user = null;
    },
    // Restaura la sesión al recargar la app (el token vive en localStorage,
    // el usuario en cache para no tener que golpear al backend en cada refresh).
    restoreSession() {
      const cached = localStorage.getItem("pos_user");
      if (cached) {
        try {
          this.user = JSON.parse(cached);
        } catch {
          this.user = null;
        }
      }
    },
  },
});
