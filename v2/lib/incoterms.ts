// Canonical incoterm list used everywhere in the Purchase & cost
// wizard. Six terms, codes stored as-is, labels for display.

export const INCOTERMS = ['EXW', 'FAS', 'FOB', 'CFR', 'CIF', 'DDP'] as const;
export type Incoterm = typeof INCOTERMS[number];

export const INCOTERM_LABELS: Record<Incoterm, string> = {
  EXW: 'EXW · Ex Works',
  FAS: 'FAS · Free Alongside Ship',
  FOB: 'FOB · Free On Board',
  CFR: 'CFR · Cost & Freight',
  CIF: 'CIF · Cost + Insurance + Freight',
  DDP: 'DDP · Delivered Duty Paid',
};

export const pickupRequiredFor = (i: string) =>
  !['FOB', 'FAS'].includes((i || '').toUpperCase());

export const destPortAppliesFor = (i: string) =>
  ['CFR', 'CIF'].includes((i || '').toUpperCase());
