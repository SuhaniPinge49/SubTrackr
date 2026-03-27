/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        deep: "#09090f",
        panel: "#111320",
        accent: "#7c3aed",
        mint: "#14b8a6",
        warn: "#f59e0b",
      },
      boxShadow: {
        glow: "0 10px 40px rgba(124,58,237,0.25)",
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
      },
      backgroundImage: {
        "grid-dark":
          "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)",
      },
    },
  },
  plugins: [],
};
