/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#f3efe6",
        ink: "#1c1915",
        moss: "#0e6b52",
        sea: "#1e4d8c",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Segoe UI", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(28, 25, 21, 0.04), 0 12px 32px rgba(28, 25, 21, 0.06)",
      },
    },
  },
  plugins: [],
};
