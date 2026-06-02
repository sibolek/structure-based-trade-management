/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#050607",
          900: "#090b0d",
          850: "#0d1013",
          800: "#11161a",
          700: "#1a2026",
          600: "#26313a",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "SFMono-Regular", "Consolas", "monospace"],
      },
      boxShadow: {
        terminal: "0 0 0 1px rgba(255,255,255,0.05), 0 18px 60px rgba(0,0,0,0.45)",
      },
    },
  },
  plugins: [],
};
