// Phase 3A — Table primitives. Pure presentational — no sorting/selection
// logic yet (TanStack Table will land in Phase 3B).

import React from 'react';
import { cn } from './utils';

export const Table: React.FC<React.HTMLAttributes<HTMLTableElement>> = ({ className, ...p }) => (
  <div className="w-full overflow-x-auto">
    <table className={cn('w-full caption-bottom text-sm', className)} {...p} />
  </div>
);
export const THead: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({ className, ...p }) => (
  <thead className={cn('border-b border-slate-200 bg-slate-50', className)} {...p} />
);
export const TBody: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({ className, ...p }) => (
  <tbody className={cn('divide-y divide-slate-100', className)} {...p} />
);
export const TR: React.FC<React.HTMLAttributes<HTMLTableRowElement>> = ({ className, ...p }) => (
  <tr className={cn('hover:bg-slate-50', className)} {...p} />
);
export const TH: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = ({ className, ...p }) => (
  <th className={cn('px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600', className)} {...p} />
);
export const TD: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({ className, ...p }) => (
  <td className={cn('px-3 py-2 text-sm text-slate-700', className)} {...p} />
);
