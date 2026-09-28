// Tema visual de la caja: tipos, tema integrado y cálculo de las variables CSS.
//
// El backend local (src/theme/contract.ts) ya entrega el tema SANEADO, así que aquí
// no se vuelve a validar campo a campo; sí se protege lo que puede romper la pantalla
// (colores mal formados) porque un fallo aquí deja la caja en blanco. El tema es solo
// datos: nunca se inyecta CSS, HTML ni JS que venga del CRM. Lo único que llega a
// `style` son números y colores que pasaron por `parseHex`.

export type Mode = "light" | "dark";

export interface ThemeColors {
  primary: string;
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  border: string;
  success: string;
  warning: string;
  danger: string;
}

export interface ThemeConfig {
  schemaVersion: number;
  mode: "light" | "dark" | "schedule";
  allowCashierToggle: boolean;
  schedule: { darkFrom: string; darkTo: string };
  colors: { light: ThemeColors; dark: ThemeColors };
  typography: {
    fontFamily: FontFamily;
    baseSize: number;
    headingWeight: 500 | 600 | 700;
  };
  shape: {
    radius: "none" | "sm" | "md" | "lg" | "xl";
    density: "compact" | "comfortable" | "spacious";
    shadows: boolean;
    borderWidth: 0 | 1 | 2;
  };
  layout: {
    cartPosition: "left" | "right";
    cartWidth: "narrow" | "normal" | "wide";
    catalogColumns: "auto" | number;
    productCard: "image-top" | "image-left" | "text-only" | "compact";
    categoriesPlacement: "top" | "left" | "hidden";
    statusBarPosition: "top" | "bottom";
    showProductImages: boolean;
  };
  branding: {
    logoFileId: string | null;
    logoDarkFileId: string | null;
    logoPosition: "left" | "right";
    logoSize: "sm" | "md" | "lg";
    showLogoOnLogin: boolean;
    loginBackground:
      | { type: "color"; color: string | null; imageFileId: null }
      | { type: "image"; color: null; imageFileId: string };
    welcomeMessage: string | null;
  };
}

export type FontFamily =
  | "system" | "inter" | "roboto" | "poppins" | "nunito" | "montserrat" | "source-sans" | "jetbrains-mono";

// "Clásico": el aspecto que la caja tenía antes de los temas. Sin tema del CRM (o antes de
// que llegue) se usa este. Debe coincidir con BUILTIN_THEME del backend.
export const BUILTIN_THEME: ThemeConfig = {
  schemaVersion: 1,
  mode: "light",
  allowCashierToggle: true,
  schedule: { darkFrom: "19:00", darkTo: "07:00" },
  colors: {
    light: {
      primary: "#2563eb", background: "#f9fafb", surface: "#ffffff", surfaceAlt: "#f3f4f6",
      text: "#1f2937", textMuted: "#6b7280", border: "#e5e7eb",
      success: "#059669", warning: "#b45309", danger: "#dc2626",
    },
    dark: {
      primary: "#3b82f6", background: "#0f172a", surface: "#1e293b", surfaceAlt: "#334155",
      text: "#f1f5f9", textMuted: "#94a3b8", border: "#334155",
      success: "#34d399", warning: "#fbbf24", danger: "#f87171",
    },
  },
  typography: { fontFamily: "system", baseSize: 16, headingWeight: 600 },
  shape: { radius: "lg", density: "comfortable", shadows: true, borderWidth: 1 },
  layout: {
    cartPosition: "right", cartWidth: "normal", catalogColumns: "auto", productCard: "image-top",
    categoriesPlacement: "top", statusBarPosition: "bottom", showProductImages: true,
  },
  branding: {
    logoFileId: null, logoDarkFileId: null, logoPosition: "left", logoSize: "md",
    showLogoOnLogin: true, loginBackground: { type: "color", color: null, imageFileId: null },
    welcomeMessage: null,
  },
};

/* ------------------------------------------------------------------ *
 * Color
 * ------------------------------------------------------------------ */

type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i] * (1 - t) + b[i] * t)) as Rgb;
}

// Luminancia relativa (WCAG 2.1) para decidir si el texto sobre un color va en blanco o negro.
function luminance([r, g, b]: Rgb): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

// Blanco o negro, el que dé mejor contraste sobre `bg` (misma regla que el editor del CRM).
export function pickOn(bg: Rgb): Rgb {
  const l = luminance(bg);
  return (1.05 / (l + 0.05)) >= ((l + 0.05) / 0.05) ? WHITE : BLACK;
}

const triplet = ([r, g, b]: Rgb): string => `${r} ${g} ${b}`;

/* ------------------------------------------------------------------ *
 * Variables CSS
 * ------------------------------------------------------------------ */

// Escala de radios de Tailwind (rem) por el ajuste "radius" del tema. `lg` = valores por
// defecto de Tailwind, así el tema integrado se ve igual que antes.
const RADIUS_FACTOR = { none: 0, sm: 0.4, md: 0.75, lg: 1, xl: 1.75 } as const;
const RADIUS_BASE_REM = { sm: 0.125, DEFAULT: 0.25, md: 0.375, lg: 0.5, xl: 0.75, "2xl": 1 } as const;

const DENSITY_FACTOR = { compact: 0.85, comfortable: 1, spacious: 1.2 } as const;

const FONT_STACKS: Record<FontFamily, string> = {
  system: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  inter: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
  roboto: '"Roboto Variable", ui-sans-serif, system-ui, sans-serif',
  poppins: '"Poppins", ui-sans-serif, system-ui, sans-serif',
  nunito: '"Nunito Variable", ui-sans-serif, system-ui, sans-serif',
  montserrat: '"Montserrat Variable", ui-sans-serif, system-ui, sans-serif',
  "source-sans": '"Source Sans 3 Variable", ui-sans-serif, system-ui, sans-serif',
  "jetbrains-mono": '"JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace',
};

const SHADOWS_ON = {
  "--sh-sm": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
  "--sh": "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
  "--sh-md": "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
  "--sh-lg": "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
} as const;

export type ThemeVars = Record<string, string>;

// Todas las variables CSS que consume la pantalla para un modo. Puro (sin `document`):
// se prueba y se cachea tal cual en localStorage para pintar al instante en el siguiente arranque.
export function deriveVars(config: ThemeConfig, mode: Mode): ThemeVars {
  const c = config.colors[mode];
  const rgb = (hex: string, fallback: string): Rgb =>
    parseHex(hex) ?? (parseHex(fallback) as Rgb);
  const base = BUILTIN_THEME.colors[mode];

  const surface = rgb(c.surface, base.surface);
  const ink = rgb(c.text, base.text);
  const line = rgb(c.border, base.border);
  const primary = rgb(c.primary, base.primary);
  const success = rgb(c.success, base.success);
  const warning = rgb(c.warning, base.warning);
  const danger = rgb(c.danger, base.danger);
  // En oscuro el "hover" aclara (oscurecer un fondo oscuro no se nota); en claro oscurece.
  const hover = (x: Rgb): Rgb => (mode === "dark" ? mix(x, WHITE, 0.12) : mix(x, BLACK, 0.12));

  const vars: ThemeVars = {
    "--c-bg": triplet(rgb(c.background, base.background)),
    "--c-surface": triplet(surface),
    "--c-surface-alt": triplet(rgb(c.surfaceAlt, base.surfaceAlt)),
    "--c-ink": triplet(ink),
    "--c-muted": triplet(rgb(c.textMuted, base.textMuted)),
    "--c-line": triplet(line),
    "--c-line-strong": triplet(mix(line, ink, 0.12)),
    "--c-primary": triplet(primary),
    "--c-primary-hover": triplet(hover(primary)),
    "--c-primary-soft": triplet(mix(surface, primary, 0.1)),
    "--c-on-primary": triplet(pickOn(primary)),
    "--c-success": triplet(success),
    "--c-success-soft": triplet(mix(surface, success, 0.14)),
    "--c-warning": triplet(warning),
    "--c-warning-soft": triplet(mix(surface, warning, 0.14)),
    "--c-danger": triplet(danger),
    "--c-danger-hover": triplet(hover(danger)),
    "--c-danger-soft": triplet(mix(surface, danger, 0.14)),
    "--c-on-danger": triplet(pickOn(danger)),
    "--font-sans": FONT_STACKS[config.typography.fontFamily] ?? FONT_STACKS.system,
    "--font-size": `${config.typography.baseSize}px`,
    "--heading-weight": String(config.typography.headingWeight),
    "--bw": `${config.shape.borderWidth}px`,
    "--dens": String(DENSITY_FACTOR[config.shape.density] ?? 1),
  };

  const k = RADIUS_FACTOR[config.shape.radius] ?? 1;
  for (const [name, rem] of Object.entries(RADIUS_BASE_REM)) {
    vars[`--r-${name === "DEFAULT" ? "base" : name}`] = `${(rem * k).toFixed(4)}rem`;
  }

  if (config.shape.shadows) {
    Object.assign(vars, SHADOWS_ON);
  } else {
    for (const key of Object.keys(SHADOWS_ON)) vars[key] = "0 0 #0000";
  }

  return vars;
}

/* ------------------------------------------------------------------ *
 * Modo claro / oscuro
 * ------------------------------------------------------------------ */

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// ¿Toca modo oscuro a esta hora? El tramo puede cruzar la medianoche (19:00 -> 07:00).
export function isDarkBySchedule(schedule: { darkFrom: string; darkTo: string }, now: Date): boolean {
  const from = toMinutes(schedule.darkFrom);
  const to = toMinutes(schedule.darkTo);
  const t = now.getHours() * 60 + now.getMinutes();
  if (from === to) return false;
  return from < to ? t >= from && t < to : t >= from || t < to;
}

export function resolveMode(config: ThemeConfig, cashierMode: Mode | null, now: Date): Mode {
  if (config.allowCashierToggle && cashierMode) return cashierMode;
  if (config.mode === "schedule") return isDarkBySchedule(config.schedule, now) ? "dark" : "light";
  return config.mode;
}
