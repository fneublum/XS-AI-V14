// Phase 3B — Tailwind local build. Replaces the runtime cdn.tailwindcss.com
// script that was in index.html. Preserves v1's `brand.*` palette and the
// `shake` animation so existing classes keep working.

import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './index.html',
    './auth.html',
    './index.tsx',
    './App.tsx',
    './{components,pages,layouts,config,utils,hooks,services}/**/*.{ts,tsx}',
    './v2/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['Roboto Mono', 'monospace'],
      },
      colors: {
        // v1's brand scale — kept so the huge pile of existing
        // `bg-brand-500` / `text-brand-600` classes doesn't change.
        brand: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        },
      },
      animation: {
        shake: 'shake 0.5s ease-in-out',
        shimmer: 'shimmer 1.6s ease-in-out infinite',
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%':      { transform: 'translateX(-4px)' },
          '75%':      { transform: 'translateX(4px)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
