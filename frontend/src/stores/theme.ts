import { defineStore } from "pinia";
import { api, apiUrl } from "../api/client";
import { onSocketConnect, onSocketEvent } from "../socket/localSocket";
import { loadFont } from "../theme/fonts";
import { BUILTIN_THEME, deriveVars, resolveMode, type Mode, type ThemeConfig } from "../theme/theme";

// Tema visual de esta caja. Lo entrega el backend local (copia del que el CRM resuelve para este
// punto de emisión) y aquí solo se APLICA: variables CSS en <html>, que Tailwind consume por nombre
// semántico (bg-surface, text-ink, bg-primary...). Sin tema, o mientras llega, rige el integrado
// ("Clásico"): el aspecto que la caja tenía antes de los temas.
//
// Sin destello: la última versión de las variables se guarda en localStorage y un script en
// index.html las pone en <html> ANTES de que se monte Vue, así la caja arranca ya con su aspecto.

const CACHE_KEY = "pos_theme_cache";
const VARS_KEY = "pos_theme_vars"; // lo lee el script de index.html
const MODE_KEY = "pos_color_mode";

interface ThemeResponse {
  source: string;
  name: string | null;
  version: number;
  config: ThemeConfig | null;
  assets: { role: string; url: string }[];
}

function readMode(): Mode | null {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function readCache(): ThemeResponse | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as ThemeResponse) : null;
  } catch {
    return null;
  }
}

export const useThemeStore = defineStore("theme", {
  state: () => ({
    config: BUILTIN_THEME as ThemeConfig,
    name: null as string | null,
    // role -> url (ya con el origen del backend)
    assets: {} as Record<string, string>,
    // Preferencia LOCAL del cajero (claro/oscuro): solo cuenta si el tema lo permite.
    cashierMode: readMode() as Mode | null,
    now: Date.now(),
    loaded: false,
    listeners: [] as Array<() => void>,
    timer: null as ReturnType<typeof setInterval> | null,
  }),
  getters: {
    mode: (state): Mode => resolveMode(state.config, state.cashierMode, new Date(state.now)),
    layout: (state) => state.config.layout,
    branding: (state) => state.config.branding,
    canToggleMode: (state) => state.config.allowCashierToggle,
    // El logotipo de la empresa según el modo (el oscuro si existe; si no, el mismo de siempre).
    logoUrl(): string | null {
      const dark = this.mode === "dark" ? this.assets.logoDark : undefined;
      return dark ?? this.assets.logo ?? null;
    },
    // Fondo de las pantallas de acceso y emparejamiento: la imagen de la empresa (ya descargada),
    // un color propio, o nada (rige el fondo del tema). Solo salen números/URLs ya validados.
    loginBackgroundStyle(): Record<string, string> {
      const bg = this.config.branding.loginBackground;
      if (bg.type === "image" && this.assets.loginBackground) {
        return {
          backgroundImage: `url("${this.assets.loginBackground}")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        };
      }
      if (bg.type === "color" && bg.color) return { backgroundColor: bg.color };
      return {};
    },
  },
  actions: {
    // Aplica el tema al documento. Es lo único que toca `document`.
    apply(): void {
      const root = document.documentElement;
      const vars = deriveVars(this.config, this.mode);
      for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
      root.style.fontSize = vars["--font-size"];
      root.style.colorScheme = this.mode;
      root.dataset.density = this.config.shape.density;
      root.dataset.mode = this.mode;
      void loadFont(this.config.typography.fontFamily);
      try {
        localStorage.setItem(VARS_KEY, JSON.stringify(vars));
      } catch {
        // sin almacenamiento: el siguiente arranque tarda un instante más en pintar el tema
      }
    },

    setFromResponse(res: ThemeResponse | null): void {
      this.config = res?.config ?? BUILTIN_THEME;
      this.name = res?.config ? res.name : null;
      this.assets = Object.fromEntries((res?.assets ?? []).map((a) => [a.role, apiUrl(a.url)]));
      this.loaded = true;
      this.apply();
    },

    async load(): Promise<void> {
      try {
        const res = await api.get<ThemeResponse>("/theme");
        this.setFromResponse(res);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(res));
        } catch {
          // ver arriba
        }
      } catch {
        // Backend local sin responder: se queda lo que ya hay (caché o integrado). Nunca bloquea.
      }
    },

    // Alterna claro/oscuro en ESTA caja (no toca el tema del CRM).
    toggleMode(): void {
      if (!this.config.allowCashierToggle) return;
      this.cashierMode = this.mode === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(MODE_KEY, this.cashierMode);
      } catch {
        // la preferencia dura hasta cerrar la caja
      }
      this.apply();
    },

    // Arranque: pinta la copia guardada al instante, pide la vigente y queda escuchando cambios.
    start(): void {
      if (this.timer) return;
      const cached = readCache();
      if (cached) this.setFromResponse(cached);
      else this.apply();
      void this.load();

      // El backend avisa `theme.changed` al bajar un tema nuevo o al desvincular (se borra).
      this.listeners.push(onSocketEvent("theme.changed", () => void this.load()));
      // Si el socket estuvo caído, el aviso pudo perderse: se resincroniza al reconectar.
      this.listeners.push(onSocketConnect(() => void this.load()));

      // Para el modo por horario: cada 30 s se reevalúa la hora.
      this.timer = setInterval(() => {
        const wasDark = this.mode === "dark";
        this.now = Date.now();
        if ((this.mode === "dark") !== wasDark) this.apply();
      }, 30_000);
    },

    stop(): void {
      for (const off of this.listeners) off();
      this.listeners = [];
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    },
  },
});
