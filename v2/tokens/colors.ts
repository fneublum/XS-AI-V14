// Phase 3A — Design token: colors.
// Source of truth for v2 palette. Values mirror the `brand-*` used in v1's
// runtime Tailwind config so a side-by-side v1/v2 render looks coherent.

export const colors = {
  brand: {
    50: '#eef2ff',
    100: '#e0e7ff',
    200: '#c7d2fe',
    300: '#a5b4fc',
    400: '#818cf8',
    500: '#6366f1',
    600: '#4f46e5',
    700: '#4338ca',
    800: '#3730a3',
    900: '#312e81',
  },
  neutral: {
    50:  '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
  },
  success: { 500: '#10b981', 600: '#059669' },
  warning: { 500: '#f59e0b', 600: '#d97706' },
  danger:  { 500: '#ef4444', 600: '#dc2626' },
} as const;

export type BrandShade = keyof typeof colors.brand;
export type NeutralShade = keyof typeof colors.neutral;
