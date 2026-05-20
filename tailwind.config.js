/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'Cascadia Code', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        // Status palette per slice 4 — defined here so later slices can use directly.
        status: {
          working: '#f59e0b', // amber
          awaiting: '#ef4444', // red
          idle: '#64748b', // slate
        },
      },
    },
  },
  plugins: [],
};
