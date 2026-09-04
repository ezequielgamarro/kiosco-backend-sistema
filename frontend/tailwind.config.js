/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./**/*.html",
    "./**/*.{js,jsx}",
    "!./node_modules/**/*",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Tokens semánticos del Design System del Punto de Venta
        'pos-bg': '#fffffe',
        'pos-text-head': '#2b2c34',
        'pos-text-body': '#2b2c34',
        'pos-primary': '#6246ea',
        'pos-primary-text': '#fffffe',
        'pos-secondary': '#d1d1e9',
        'pos-stroke': '#2b2c34',
        'pos-danger': '#e45858',
      },
      fontFamily: {
        base: ['"Jost"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'pos-card': '0 1px 3px 0 rgba(43,44,52,0.10), 0 1px 2px -1px rgba(43,44,52,0.10)',
        'pos-primary': '0 10px 15px -3px rgba(98,70,234,0.35), 0 4px 6px -4px rgba(98,70,234,0.35)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
  ],
}
