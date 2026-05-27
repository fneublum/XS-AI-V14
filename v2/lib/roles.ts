// Centralised role gating.
//
// Admin-tier roles are OWNER (workspace founder) and ADMIN (delegated
// administrators). The check tolerates legacy mixed-case strings
// because users.role has been stored as both 'admin' and 'ADMIN'
// across the v1 → v2 migration.
//
// Used by:
//   - v2/AppV2.tsx        — hides Settings from the sidebar for non-admins
//   - v2/layout/SettingsMenuModal.tsx — refuses to render the menu items
//   - v2/AppV2.tsx (route render) — refuses to render Companies / Users
//     / Connections routes for non-admins (URL deep-link guard)
//
// Add new roles to ADMIN_TIER below as the role taxonomy evolves.

export const ADMIN_TIER: ReadonlySet<string> = new Set([
  'OWNER', 'ADMIN',
]);

export function isAdminRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return ADMIN_TIER.has(role.toUpperCase());
}
