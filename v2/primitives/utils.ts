// Phase 3A — Utility helpers for primitives.
// Minimal `cn()` — concatenates class names, dropping falsy values.
// Avoids pulling in `clsx` / `tailwind-merge` until package.json is updated.

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
