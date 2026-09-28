import type { FontFamily } from "./theme";

// Las fuentes viajan DENTRO de la app (la caja no tiene por qué tener internet ni se debe pedir
// nada a un CDN), pero solo se descarga del disco la que el tema usa: cada familia es un import
// dinámico, que Vite parte en su propio archivo. Solo el subconjunto latino (cubre español).
//
// Se registran con la API FontFace en vez de importar los .css de @fontsource porque esos
// traen TODOS los alfabetos (cirílico, griego, vietnamita...) y multiplicarían el tamaño del
// paquete de la app, que se descarga en cada actualización.

interface Face {
  family: string;
  weight: string;
  load: () => Promise<{ default: string }>;
}

const FACES: Partial<Record<FontFamily, Face[]>> = {
  inter: [{ family: "Inter Variable", weight: "100 900", load: () => import("@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url") }],
  roboto: [{ family: "Roboto Variable", weight: "100 900", load: () => import("@fontsource-variable/roboto/files/roboto-latin-wght-normal.woff2?url") }],
  nunito: [{ family: "Nunito Variable", weight: "200 1000", load: () => import("@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2?url") }],
  montserrat: [{ family: "Montserrat Variable", weight: "100 900", load: () => import("@fontsource-variable/montserrat/files/montserrat-latin-wght-normal.woff2?url") }],
  "source-sans": [{ family: "Source Sans 3 Variable", weight: "200 900", load: () => import("@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-normal.woff2?url") }],
  "jetbrains-mono": [{ family: "JetBrains Mono Variable", weight: "100 800", load: () => import("@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url") }],
  // Poppins no tiene versión variable: un archivo por grosor.
  poppins: [400, 500, 600, 700, 800].map((w) => ({
    family: "Poppins",
    weight: String(w),
    load: () => {
      switch (w) {
        case 400: return import("@fontsource/poppins/files/poppins-latin-400-normal.woff2?url");
        case 500: return import("@fontsource/poppins/files/poppins-latin-500-normal.woff2?url");
        case 600: return import("@fontsource/poppins/files/poppins-latin-600-normal.woff2?url");
        case 700: return import("@fontsource/poppins/files/poppins-latin-700-normal.woff2?url");
        default: return import("@fontsource/poppins/files/poppins-latin-800-normal.woff2?url");
      }
    },
  })),
};

const loaded = new Set<FontFamily>();

// "system" no descarga nada. Un fallo (archivo ausente, sin FontFace) se ignora: el texto
// sigue saliendo con la fuente de respaldo de la pila, que es exactamente lo que se quiere.
export async function loadFont(family: FontFamily): Promise<void> {
  const faces = FACES[family];
  if (!faces || loaded.has(family) || typeof FontFace === "undefined") return;
  loaded.add(family);
  try {
    await Promise.all(
      faces.map(async (f) => {
        const { default: url } = await f.load();
        const face = new FontFace(f.family, `url(${url}) format("woff2")`, { weight: f.weight, display: "swap" });
        document.fonts.add(await face.load());
      }),
    );
  } catch (err) {
    loaded.delete(family);
    console.warn(`[theme] no se pudo cargar la fuente ${family}:`, err instanceof Error ? err.message : err);
  }
}
