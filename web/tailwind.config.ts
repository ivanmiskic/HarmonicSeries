import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#050508",
        elevated: "rgba(255,255,255,0.03)",
        hairline: "rgba(255,255,255,0.08)",
        accent: { DEFAULT: "#6EE7B7", indigo: "#818CF8", warn: "#FBBF24" },
        muted: "#71717A",
        foreground: "#F4F4F5",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
      animation: {
        float: "float 8s ease-in-out infinite",
        "float-delay": "float 8s ease-in-out 4s infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-12px)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
