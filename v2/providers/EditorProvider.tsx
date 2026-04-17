// Phase 3B — Shared editor state.
//
// Allows any component (palette, page, keyboard shortcut) to open the
// Sales Order drawer without hoisting state through every layer. The
// drawer itself is mounted once in AppV2.

import React, { createContext, useContext, useMemo, useState } from 'react';
import { SalesOrder } from '../queries/useSalesOrders';

interface EditorContextValue {
  editingSalesOrder: SalesOrder | null;
  openSalesOrder: (order: SalesOrder) => void;
  closeSalesOrder: () => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export const useEditor = (): EditorContextValue => {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditor must be used within <EditorProvider />');
  return ctx;
};

export const EditorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [editingSalesOrder, setEditingSalesOrder] = useState<SalesOrder | null>(null);

  const value = useMemo<EditorContextValue>(() => ({
    editingSalesOrder,
    openSalesOrder: (order) => setEditingSalesOrder(order),
    closeSalesOrder: () => setEditingSalesOrder(null),
  }), [editingSalesOrder]);

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
};
