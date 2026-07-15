/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--market-canvas)',
        ink: 'var(--market-ink)',
        accent: 'var(--market-accent)',
        panel: 'var(--market-panel)',
        muted: 'var(--market-muted)',
        line: 'var(--market-line)',
      },
      fontFamily: {
        sans: ['Inter', 'PingFang SC', 'Segoe UI', 'sans-serif'],
        serif: ['Source Serif 4', 'Noto Serif SC', 'serif'],
        mono: ['Geist Mono', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 10px 30px rgba(38, 37, 30, 0.055)',
        panel: '0 18px 48px rgba(38, 37, 30, 0.08)',
      },
    },
  },
  plugins: [],
}
