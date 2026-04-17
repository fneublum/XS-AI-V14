// Phase 3B — Shimmer skeleton. Matches the Linear dark palette.

import React from 'react';
import { cn } from './utils';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: string | number;
  height?: string | number;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className, width, height, style, ...rest
}) => (
  <div
    aria-hidden
    className={cn(
      'rounded bg-gradient-to-r from-[#161616] via-[#1f1f1f] to-[#161616] bg-[length:200%_100%]',
      'animate-[shimmer_1.6s_ease-in-out_infinite]',
      className,
    )}
    style={{
      width: typeof width === 'number' ? `${width}px` : width,
      height: typeof height === 'number' ? `${height}px` : height ?? '1rem',
      ...style,
    }}
    {...rest}
  />
);

// Inject the keyframes once.
if (typeof document !== 'undefined' && !document.getElementById('v2-skeleton-keyframes')) {
  const style = document.createElement('style');
  style.id = 'v2-skeleton-keyframes';
  style.textContent = `@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`;
  document.head.appendChild(style);
}
