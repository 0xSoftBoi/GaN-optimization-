import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#070a0f",
          900: "#0a0e14",
          800: "#11161f",
          700: "#1a2230",
          600: "#243044",
        },
        volt: {
          DEFAULT: "#22d3ee",
          dim: "#0e7490",
        },
        amber: {
          glow: "#f59e0b",
        },
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
