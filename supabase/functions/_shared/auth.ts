// Shared auth helper for client-called Edge Functions.
//
// Requires the Authorization: Bearer <access_token> header set by the
// Supabase client. Returns the authenticated user row or a 401 Response.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface AuthedUser {
  id: string;
  email?: string;
}

/**
 * Verify the caller's Supabase JWT. Returns either the authed user or a
 * ready-to-send 401 Response.
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

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Use anon client + forwarded token. This enforces RLS AND verifies the JWT.
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) {
    return {
      response: new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      ),
    };
  }

  return { user: { id: data.user.id, email: data.user.email } };
}
