/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: 'var(--color-brand)', dark: 'var(--color-brand-dark)' },
      },
    },
  },
  plugins: [],
};
