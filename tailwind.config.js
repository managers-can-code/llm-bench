/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      // Semantic color tokens. Use these in new code; the raw zinc/red/etc.
      // utilities still work for one-off cases.
      colors: {
        // Surfaces (lightest = top of the stack)
        surface: {
          0: "#09090b", // zinc-950 — root background
          1: "#18181b", // zinc-900 — cards, inputs
          2: "#27272a", // zinc-800 — raised
        },
        // Border / divider
        border: {
          DEFAULT: "#27272a", // zinc-800
          strong: "#3f3f46", // zinc-700
          hover: "#52525b", // zinc-600
        },
        // Text. WCAG AA against surface-0:
        //   primary  zinc-100 (20.0:1)
        //   secondary zinc-400 (~7.0:1)
        //   tertiary  zinc-500 (~4.6:1) — borderline; reserve for non-essential
        text: {
          primary: "#f4f4f5", // zinc-100
          secondary: "#a1a1aa", // zinc-400
          tertiary: "#71717a", // zinc-500
        },
      },
    },
  },
  plugins: [],
};
