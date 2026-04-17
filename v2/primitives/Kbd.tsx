// Phase 3A — Keyboard shortcut hint. Linear/Vercel: mono-spaced, subtle.

import React from 'react';
import { cn } from './utils';

export const Kbd: React.FC<React.HTMLAttributes<HTMLElement>> = ({
  className, children, ...rest
}) => (
  <kbd
    className={cn(
      'font-mono text-[10px] text-slate-500 bg-[#161616] border border-[#1f1f1f] rounded px-1 py-px leading-none',
      className,
    )}
    {...rest}
  >
    {children}
  </kbd>
);
