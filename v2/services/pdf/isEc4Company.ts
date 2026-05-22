// The EC4-branded stamp graphic (/public/ec4_stamp.png) should only
// appear on documents belonging to EC4 Enterprises. Other companies'
// PDFs must render without it. Match by name to avoid hardcoding a
// specific company ID — `EC4 ENTERPRISES LLC` is the canonical name.

import type { PdfCompany } from './types';

export function isEc4Company(c: PdfCompany | null | undefined): boolean {
  if (!c?.name) return false;
  return c.name.toUpperCase().includes('EC4');
}
