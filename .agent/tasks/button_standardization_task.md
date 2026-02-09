# Task: UI Button Standardization

## Objective
Standardize "New" or "Add" buttons across the application to use an icon-only style with the `FilePlus` icon from `lucide-react`, ensuring consistent user interface and resolving any resulting lint errors.

## Completed Actions

### 1. Button Standardization & Import Fixes
The following files were updated to:
- Use `FilePlus` icon for "New" or "Add" actions.
- Ensure `FilePlus` is correctly imported from `lucide-react`.

#### Files Updated:
- **`BigCalculator.tsx`**: Updated "New Product" button to use `FilePlus`. Verified "New Calculation" button uses `FilePlus`.
- **`Ports.tsx`**: Added `FilePlus` import. Button already standardized.
- **`CargoAgents.tsx`**: Added `FilePlus` import. Button already standardized.
- **`Carriers.tsx`**: Added `FilePlus` import. Button already standardized.
- **`SupplierOffers.tsx`**: Added `FilePlus` import. Button already standardized.
- **`SupplierQuotes.tsx`**: Added `FilePlus` import. Button already standardized.
- **`PurchaseOrders.tsx`**: Added `FilePlus` import. Button already standardized.
- **`Locations.tsx`**: Added `FilePlus` import. Button already standardized.
- **`Suppliers.tsx`**: Added `FilePlus` import. Button already standardized.
- **`Shipments.tsx`**: Added `FilePlus` import. Button already standardized.

#### Previously Verified/Completed:
- **`Commissions.tsx`**: Verified.
- **`FreightQuotes.tsx`**: Verified.
- **`SalesOrders.tsx`**: Verified (Import confirmed).
- **`Products.tsx`**: Verified.
- **`CalculationSheet.tsx`**: Verified.
- **`Customers.tsx`**: Verified.

### 2. Analysis of `CustomerPortal.tsx`
- Investigated `CustomerPortal.tsx` for potential "New Order" button standardization.
- Found no user-facing "New Order" button or `Plus` icon usage for such actions in the current codebase. No changes were made to this file.

## Technical Details
- **Icon**: `FilePlus` from `lucide-react`.
- **Style**: Icon-only buttons with `title` attributes for accessibility (tooltips).
- **Linting**: Fixed `Cannot find name 'FilePlus'` errors by adding missing imports in 9 files.

## Status
- **Analysis**: Complete.
- **Implementation**: Complete.
- **Verification**: Complete. All identified files have valid imports and consistent button usage.
