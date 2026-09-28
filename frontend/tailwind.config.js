/** @type {import('tailwindcss').Config} */

// Los colores NO están escritos aquí: son variables CSS (--c-*) que el tema de la caja rellena en
// tiempo de ejecución (src/theme/theme.ts -> stores/theme.ts). Con `<alpha-value>` siguen valiendo
// las variantes con opacidad (bg-primary/10, border-line/60...). Los valores por defecto (tema
// "Clásico") reproducen el aspecto que la caja tenía antes de los temas.
const color = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

// Densidad: escala SOLO relleno y separación (padding, gap, space), nunca anchos ni altos fijos,
// para que "compacto" apriete la pantalla sin romper los objetivos táctiles.
const SPACING_STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const dense = Object.fromEntries(
  SPACING_STEPS.map((n) => [String(n), `calc(${n * 0.25}rem * var(--dens, 1))`]),
);

export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        page: color("bg"),
        surface: { DEFAULT: color("surface"), alt: color("surface-alt") },
        ink: color("ink"),
        muted: color("muted"),
        line: { DEFAULT: color("line"), strong: color("line-strong") },
        primary: {
          DEFAULT: color("primary"),
          hover: color("primary-hover"),
          soft: color("primary-soft"),
          on: color("on-primary"),
        },
        success: { DEFAULT: color("success"), soft: color("success-soft") },
        warning: { DEFAULT: color("warning"), soft: color("warning-soft") },
        danger: {
          DEFAULT: color("danger"),
          hover: color("danger-hover"),
          soft: color("danger-soft"),
          on: color("on-danger"),
        },
      },
      fontFamily: { sans: ["var(--font-sans)"] },
      borderRadius: {
        sm: "var(--r-sm, 0.125rem)",
        DEFAULT: "var(--r-base, 0.25rem)",
        md: "var(--r-md, 0.375rem)",
        lg: "var(--r-lg, 0.5rem)",
        xl: "var(--r-xl, 0.75rem)",
        "2xl": "var(--r-2xl, 1rem)",
      },
      borderWidth: { DEFAULT: "var(--bw, 1px)" },
      boxShadow: {
        sm: "var(--sh-sm, 0 1px 2px 0 rgb(0 0 0 / 0.05))",
        DEFAULT: "var(--sh, 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1))",
        md: "var(--sh-md, 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1))",
        lg: "var(--sh-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1))",
      },
      padding: dense,
      gap: dense,
      space: dense,
    },
  },
  plugins: [],
};
