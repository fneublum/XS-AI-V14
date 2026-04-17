# Phase 1e — Auth migration plan (HS256 bridge → Supabase Auth)

**Status:** DRAFT (plan only, no code changes)
**Goal:** retire `auth-issue` bridge in favor of native Supabase Auth so
that `auth.jwt()` claims used by the Phase 1d RLS policies are issued
and rotated by Supabase itself — not by our own edge function.

## Today (post Phase 1c)

Login flow:
1. `src/pages/Login.tsx` POSTs username+password to Supabase's REST
   endpoint against the `users` table (anon key).
2. Custom `services/authService.ts` checks the returned row's
   password hash.
3. On success, calls Edge Function `auth-issue` which mints an HS256
   JWT using `SUPABASE_JWT_SECRET` with claims `sub`, `email`, `role`,
   and signs with `djwt@v3.0.1`.
4. The JWT is stored in `sessionStorage` (in-memory fallback) and
   attached to every Edge Function call via `services/edgeAuth.ts`.

Problems:
- Passwords are stored in our own `users` table, not Supabase Auth.
- No password reset, no MFA, no rate limiting, no account lockout,
  no password complexity — all features we'd build ourselves.
- `auth-issue` is a privileged path that mints a JWT the rest of the
  system trusts. A bug there = full account takeover.
- The JWT lacks `allowed_company_ids` which Phase 1d needs.
- Session rotation is manual (token lives for N hours, no refresh).

## Target: Supabase Auth (email/password + optional MFA)

Once migrated:
- Supabase issues the JWT with its own JWKS / HS256.
- `auth.jwt()` on the DB side returns the claims automatically — Phase
  1d's `current_user_companies()` helper Just Works.
- Refresh tokens, password reset, email verification all handled by
  Supabase.
- Delete `supabase/functions/auth-issue/` entirely.

## Migration plan

### Step 1 — Create Supabase Auth users from existing rows

One-time script (server-side, run against service role):
```ts
for (const user of existingUsers) {
  const tmpPassword = crypto.randomBytes(32).toString('hex');
  await supabaseAdmin.auth.admin.createUser({
    email: user.email,
    password: tmpPassword,
    email_confirm: true,
    app_metadata: {
      role: user.role,
      allowed_company_ids: user.allowed_company_ids,
      allowed_modules: user.allowed_modules,
      linked_entity_id: user.linked_entity_id,
    },
    user_metadata: {
      name: user.name,
      avatarInitials: user.avatarInitials,
    },
  });
  // send password reset email so the user sets their own password
  await supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email: user.email });
}
```

The `app_metadata` block is the critical piece — `allowed_company_ids`
inside `app_metadata` is signed into the JWT and unreadable/unwriteable
from the client. That makes it safe for RLS to trust.

### Step 2 — Swap the login page

Replace `Login.tsx`'s raw REST call with:
```ts
const { data, error } = await supabase.auth.signInWithPassword({ email, password });
```

Remove `services/authService.ts`'s password-check path. Keep a thin
post-login step that fetches the `users` row to hydrate `userDetails`
state (name, avatarInitials, etc.) — those stay denormalized for
backward-compat until Phase 3 UI rebuild.

### Step 3 — Delete auth-issue

Once every client path is on `supabase.auth.*`, the Edge Function
becomes dead code:
- Delete `supabase/functions/auth-issue/`.
- Delete `SUPABASE_JWT_SECRET` from Edge Function secrets.
- Update `services/edgeAuth.ts` to read the session JWT from the
  Supabase client (`supabase.auth.getSession()`) rather than its own
  sessionStorage store.
- Update CSP to remove any auth-issue-specific connect-src entries.

### Step 4 — RLS lands

Phase 1d migration now runs against a system where every live session
has `allowed_company_ids` in its JWT claims. No empty-app risk.

## Side work

### 4a — QuickBooks OAuth state parameter

Today the QB OAuth state param may be replayable. Swap for a
CSRF-safe HMAC-signed token issued by `qb-auth` that encodes
`{ userId, companyId, nonce, expiresAt }`, stored in a short-TTL
Supabase table (`oauth_states`) and invalidated on use.

### 4b — TOTP for admin role

After Supabase Auth is live:
```ts
await supabase.auth.mfa.enroll({ factorType: 'totp' });
```
Gate any route with `role === 'ADMIN'` behind a "needs MFA" check by
reading `amr` from the JWT — if the last auth factor wasn't TOTP, redirect
to enrollment.

## Rollback

If Supabase Auth signIn fails in production:
1. Keep `auth-issue` deployed until full confidence (~2 weeks post cutover).
2. Feature-flag the login form with `?legacy=1` fallback to the old flow.
3. Backfill direction is one-way: once a user sets their own password via
   the recovery link, their old password in the `users` table is stale.
   Drop the `password` column after the 2-week window.

## Exit criteria

- [ ] `supabase.auth.signInWithPassword` is the only login path.
- [ ] `auth-issue` Edge Function deleted and dropped from the project.
- [ ] `users.password` column dropped (post-cutover cleanup).
- [ ] Every admin user enrolled in TOTP MFA.
- [ ] QB OAuth state is HMAC-signed and single-use.
- [ ] RLS (Phase 1d) enabled and producing no "empty-app" incidents.
