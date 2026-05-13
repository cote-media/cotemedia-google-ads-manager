/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-body)'],
        display: ['var(--font-display)'],
        mono: ['var(--font-mono)'],
      },
      colors: {
        ink: '#1a2332',
        paper: '#FFFFFF',
        accent: '#2563eb',
        muted: '#6b7280',
        surface: '#f8fafc',
        border: '#e2e8f0',
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
}
