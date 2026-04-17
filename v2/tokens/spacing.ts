// Phase 3A — Design token: spacing scale (4px base).
// Matches Tailwind's default scale so the two systems stay interoperable.

export const spacing = {
  0:  '0px',
  1:  '0.25rem', // 4px
  2:  '0.5rem',  // 8px
  3:  '0.75rem', // 12px
  4:  '1rem',    // 16px
  5:  '1.25rem', // 20px
  6:  '1.5rem',  // 24px
  8:  '2rem',    // 32px
  10: '2.5rem',  // 40px
  12: '3rem',    // 48px
  16: '4rem',    // 64px
  20: '5rem',    // 80px
} as const;

export type SpacingToken = keyof typeof spacing;
