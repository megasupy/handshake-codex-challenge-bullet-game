/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        void: "#07090f",
        panel: "#111827",
        line: "#243044",
        pulse: "#5eead4",
        danger: "#fb7185",
        gold: "#facc15",
      },
      boxShadow: {
        glow: "0 0 38px rgb(94 234 212 / 0.18)",
      },
    },
  },
  plugins: [],
};
