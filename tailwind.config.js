/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/src/**/*.{js,jsx,ts,tsx}'],
  csstailwind: true,
  theme: {
    extend: {
      colors: {
        film: {
          50: '#fdf8f0',
          100: '#faefd9',
          200: '#f3d9a8',
          300: '#eabe70',
          400: '#e09f42',
          500: '#c8832a',
          600: '#a8651e',
          700: '#8B4E19',
          800: '#6b3a15',
          900: '#4a2810'
        }
      }
    }
  },
  plugins: []
}
