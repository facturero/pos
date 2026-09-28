// Contrato del tema visual de la caja (schemaVersion 1) y su saneado.
//
// El CRM define el contrato (organization-service/src/domain/pos-theme.ts) y esta
// es una COPIA deliberada: la caja se actualiza aparte del CRM, así que no puede
// fiarse de lo que le llega. Un CRM más nuevo puede mandar campos que aquí no se
// conocen (se ignoran) y un tema a medias o corrupto NUNCA debe dejar la caja
// inservible: cada campo se valida por su cuenta y, si no vale, cae a su valor por
// defecto. El resultado de `sanitizeTheme` siempre es un tema completo y válido.
//
// El tema es solo datos: nunca CSS, HTML ni JS. Los `fileId` de imágenes se
// validan con la misma regla que las imágenes de producto (nunca salen del
// directorio de archivos).

export const THEME_SCHEMA_VERSION = 1;

export const FONT_FAMILIES = [
  "system", "inter", "roboto", "poppins", "nunito", "montserrat", "source-sans", "jetbrains-mono",
] as const;
export const RADII = ["none", "sm", "md", "lg", "xl"] as const;
export const DENSITIES = ["compact", "comfortable", "spacious"] as const;
export const HEADING_WEIGHTS = [500, 600, 700] as const;
export const BORDER_WIDTHS = [0, 1, 2] as const;
export const MODES = ["light", "dark", "schedule"] as const;
export const CART_POSITIONS = ["left", "right"] as const;
export const CART_WIDTHS = ["narrow", "normal", "wide"] as const;
export const PRODUCT_CARDS = ["image-top", "image-left", "text-only", "compact"] as const;
export const CATEGORIES_PLACEMENTS = ["top", "left", "hidden"] as const;
export const STATUS_BAR_POSITIONS = ["top", "bottom"] as const;
export const LOGO_POSITIONS = ["left", "right"] as const;
export const LOGO_SIZES = ["sm", "md", "lg"] as const;

export const COLOR_TOKENS = [
  "primary", "background", "surface", "surfaceAlt", "text", "textMuted", "border", "success", "warning", "danger",
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];
export type ThemeColors = Record<ColorToken, string>;

export type LoginBackground =
  | { type: "color"; color: string | null; imageFileId: null }
  | { type: "image"; color: null; imageFileId: string };

export interface ThemeConfig {
  schemaVersion: number;
  mode: (typeof MODES)[number];
  allowCashierToggle: boolean;
  schedule: { darkFrom: string; darkTo: string };
  colors: { light: ThemeColors; dark: ThemeColors };
  typography: {
    fontFamily: (typeof FONT_FAMILIES)[number];
    baseSize: number;
    headingWeight: (typeof HEADING_WEIGHTS)[number];
  };
  shape: {
    radius: (typeof RADII)[number];
    density: (typeof DENSITIES)[number];
    shadows: boolean;
    borderWidth: (typeof BORDER_WIDTHS)[number];
  };
  layout: {
    cartPosition: (typeof CART_POSITIONS)[number];
    cartWidth: (typeof CART_WIDTHS)[number];
    catalogColumns: "auto" | number;
    productCard: (typeof PRODUCT_CARDS)[number];
    categoriesPlacement: (typeof CATEGORIES_PLACEMENTS)[number];
    statusBarPosition: (typeof STATUS_BAR_POSITIONS)[number];
    showProductImages: boolean;
  };
  branding: {
    logoFileId: string | null;
    logoDarkFileId: string | null;
    logoPosition: (typeof LOGO_POSITIONS)[number];
    logoSize: (typeof LOGO_SIZES)[number];
    showLogoOnLogin: boolean;
    loginBackground: LoginBackground;
    welcomeMessage: string | null;
  };
}

// "Clásico": el aspecto que la caja tenía ANTES de los temas (paleta gray/blue de
// Tailwind, categorías arriba, carrito a la derecha). Sin tema del CRM se usa este,
// y el frontend lo replica en `tailwind.config.js`/`theme/builtin.ts`.
export const BUILTIN_THEME: ThemeConfig = {
  schemaVersion: THEME_SCHEMA_VERSION,
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

const HEX = /^#[0-9a-fA-F]{6}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
// Misma regla que las imágenes de producto (src/sync/images.ts).
export const FILE_ID = /^[0-9a-zA-Z-]{8,64}$/;
export const WELCOME_MAX = 80;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function pick<T extends string | number>(v: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;
}
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const fileId = (v: unknown): string | null => (typeof v === "string" && FILE_ID.test(v) ? v : null);

function colors(v: unknown, fallback: ThemeColors): ThemeColors {
  const src = isObj(v) ? v : {};
  const out = { ...fallback };
  for (const token of COLOR_TOKENS) {
    const c = src[token];
    if (typeof c === "string" && HEX.test(c)) out[token] = c.toLowerCase();
  }
  return out;
}

// Devuelve SIEMPRE un tema completo. `raw` puede ser cualquier cosa (JSON de un CRM más
// nuevo o más viejo, o basura): lo que no se reconoce se descarta campo a campo.
export function sanitizeTheme(raw: unknown): ThemeConfig {
  const b = BUILTIN_THEME;
  const r = isObj(raw) ? raw : {};
  const colorsRaw = isObj(r.colors) ? r.colors : {};
  const schedule = isObj(r.schedule) ? r.schedule : {};
  const typo = isObj(r.typography) ? r.typography : {};
  const shape = isObj(r.shape) ? r.shape : {};
  const layout = isObj(r.layout) ? r.layout : {};
  const brand = isObj(r.branding) ? r.branding : {};

  const columns = layout.catalogColumns;
  const catalogColumns: "auto" | number =
    typeof columns === "number" && Number.isInteger(columns) && columns >= 2 && columns <= 6 ? columns : "auto";

  const baseSize = typo.baseSize;

  // Fondo del acceso: una imagen sin archivo válido no vale, se vuelve a "color".
  const bgRaw = isObj(brand.loginBackground) ? brand.loginBackground : {};
  const bgImage = fileId(bgRaw.imageFileId);
  const bgColor = typeof bgRaw.color === "string" && HEX.test(bgRaw.color) ? bgRaw.color.toLowerCase() : null;
  const loginBackground: LoginBackground =
    bgRaw.type === "image" && bgImage
      ? { type: "image", color: null, imageFileId: bgImage }
      : { type: "color", color: bgColor, imageFileId: null };

  const welcome =
    typeof brand.welcomeMessage === "string" && brand.welcomeMessage.trim().length > 0
      ? brand.welcomeMessage.trim().slice(0, WELCOME_MAX)
      : null;

  return {
    schemaVersion: THEME_SCHEMA_VERSION,
    mode: pick(r.mode, MODES, b.mode),
    allowCashierToggle: bool(r.allowCashierToggle, b.allowCashierToggle),
    schedule: {
      darkFrom: typeof schedule.darkFrom === "string" && TIME.test(schedule.darkFrom) ? schedule.darkFrom : b.schedule.darkFrom,
      darkTo: typeof schedule.darkTo === "string" && TIME.test(schedule.darkTo) ? schedule.darkTo : b.schedule.darkTo,
    },
    colors: { light: colors(colorsRaw.light, b.colors.light), dark: colors(colorsRaw.dark, b.colors.dark) },
    typography: {
      fontFamily: pick(typo.fontFamily, FONT_FAMILIES, b.typography.fontFamily),
      baseSize:
        typeof baseSize === "number" && Number.isInteger(baseSize) && baseSize >= 14 && baseSize <= 20
          ? baseSize
          : b.typography.baseSize,
      headingWeight: pick(typo.headingWeight, HEADING_WEIGHTS, b.typography.headingWeight),
    },
    shape: {
      radius: pick(shape.radius, RADII, b.shape.radius),
      density: pick(shape.density, DENSITIES, b.shape.density),
      shadows: bool(shape.shadows, b.shape.shadows),
      borderWidth: pick(shape.borderWidth, BORDER_WIDTHS, b.shape.borderWidth),
    },
    layout: {
      cartPosition: pick(layout.cartPosition, CART_POSITIONS, b.layout.cartPosition),
      cartWidth: pick(layout.cartWidth, CART_WIDTHS, b.layout.cartWidth),
      catalogColumns,
      productCard: pick(layout.productCard, PRODUCT_CARDS, b.layout.productCard),
      categoriesPlacement: pick(layout.categoriesPlacement, CATEGORIES_PLACEMENTS, b.layout.categoriesPlacement),
      statusBarPosition: pick(layout.statusBarPosition, STATUS_BAR_POSITIONS, b.layout.statusBarPosition),
      showProductImages: bool(layout.showProductImages, b.layout.showProductImages),
    },
    branding: {
      logoFileId: fileId(brand.logoFileId),
      logoDarkFileId: fileId(brand.logoDarkFileId),
      logoPosition: pick(brand.logoPosition, LOGO_POSITIONS, b.branding.logoPosition),
      logoSize: pick(brand.logoSize, LOGO_SIZES, b.branding.logoSize),
      showLogoOnLogin: bool(brand.showLogoOnLogin, b.branding.showLogoOnLogin),
      loginBackground,
      welcomeMessage: welcome,
    },
  };
}

export type AssetRole = "logo" | "logoDark" | "loginBackground";
export interface ThemeAsset {
  role: AssetRole;
  fileId: string;
}

// Las imágenes que el tema necesita, sacadas del tema YA saneado (no se confía en la
// lista `assets` que mande el servidor: se calcula aquí de lo que de verdad se usará).
export function themeAssets(config: ThemeConfig): ThemeAsset[] {
  const assets: ThemeAsset[] = [];
  const { logoFileId, logoDarkFileId, loginBackground } = config.branding;
  if (logoFileId) assets.push({ role: "logo", fileId: logoFileId });
  if (logoDarkFileId) assets.push({ role: "logoDark", fileId: logoDarkFileId });
  if (loginBackground.type === "image") assets.push({ role: "loginBackground", fileId: loginBackground.imageFileId });
  return assets;
}
