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
        ink: '#0D0D0D',
        paper: '#F5F2EC',
        accent: '#C8412B',
        muted: '#8A8580',
        surface: '#EDEAE3',
        border: '#D4CFC6',
      },
    },
  },
  plugins: [],
}
