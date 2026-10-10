/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#e8edf5', muted: '#8b98ab', faint: '#5d6a7e' },
        base: '#0a0d12',
        panel: { DEFAULT: '#0f1520', 2: '#141c29', 3: '#1a2433' },
        line: { DEFAULT: '#1f2b3c', strong: '#2c3b51' },
        profit: { DEFAULT: '#2bd576', dim: '#1a7f49' },
        loss: { DEFAULT: '#ff5d5d', dim: '#9b3333' },
        gold: { DEFAULT: '#f5c451', dim: '#a5832f' },
        info: '#5b9dff',
        warn: '#ffad42',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
}
