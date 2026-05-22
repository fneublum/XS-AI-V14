// Shared auth helper for client-called Edge Functions.
//
// Verifies the Authorization: Bearer <token> header. The token is the
// HS256 JWT minted by `auth-issue` and signed with APP_JWT_SIGNING_SECRET.
//
// Historical note — we used to call `supabase.auth.getUser()` for
// verification, but recent GoTrue versions reject tokens whose `sub`
// claim isn't a UUID ("invalid claim: sub claim must be a UUID"). Our
// `users.id` values are strings like `U1766185306346`, so GoTrue 400s
// them and the edge function silently 401s the client. We therefore
// verify the JWT locally here — same HS256 key, same claims the
// auth-issue function writes — so our own id scheme is respected.

import { verify as verifyJwt } from 'https://deno.land/x/djwt@v3.0.1/mod.ts';

export interface AuthedUser {
  id: string;
  email?: string;
  allowedCompanyIds: string[];
}

let cachedKey: CryptoKey | null = null;
async function getSigningKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const secret = Deno.env.get('APP_JWT_SIGNING_SECRET') || '';
  if (!secret) throw new Error('APP_JWT_SIGNING_SECRET not configured');
  cachedKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return cachedKey;
}

/**
 * Verify the caller's app-minted JWT. Returns either the authed user or
 * a ready-to-send 401 Response. Does NOT talk to GoTrue.
 */
export async function requireUser(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<{ user: AuthedUser } | { response: Response }> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      response: new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      ),
    };
  }
  const token = authHeader.slice('Bearer '.length).trim();
  // Reject an anon-key-only call (no user token). Anon keys have
  // `role: "anon"`; our minted tokens have `role: "authenticated"`.
  // We enforce "authenticated" below after claim verification.
  try {
    const key = await getSigningKey();
    const claims = await verifyJwt(token, key) as Record<string, unknown>;
    const sub = typeof claims.sub === 'string' ? claims.sub : '';
    const role = typeof claims.role === 'string' ? claims.role : '';
    if (!sub || role !== 'authenticated') {
      return {
        response: new Response(
          JSON.stringify({ error: 'Invalid or expired token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        ),
      };
    }
    const appMeta = (claims.app_metadata && typeof claims.app_metadata === 'object')
      ? claims.app_metadata as Record<string, unknown>
      : {};
    const rawAllowed = appMeta.allowed_company_ids;
    const allowedCompanyIds = Array.isArray(rawAllowed)
      ? rawAllowed.filter((v): v is string => typeof v === 'string')
      : [];
    return {
      user: {
        id: sub,
        email: typeof claims.email === 'string' ? claims.email : undefined,
        allowedCompanyIds,
      },
    };
  } catch {
    return {
      response: new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      ),
    };
  }
}
