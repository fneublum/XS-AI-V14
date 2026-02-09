import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Supabase Configuration
const SUPABASE_URL = 'https://qfskvevighylzzmyiwre.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmc2t2ZXZpZ2h5bHp6bXlpd3JlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwODE2MzQsImV4cCI6MjA3OTY1NzYzNH0.MZ3S57O9J6LGHaN5zbuNmW8Gt7Hg5MaJSF-U-JhTa0Q';

// Singleton instance
let supabaseInstance: SupabaseClient | null = null;

// Helper to get config from storage (Restored for AdminSettings)
export const getSupabaseConfig = () => {
    return { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };
}

/**
 * Get or create the Supabase client instance
 * Uses singleton pattern to ensure only one client exists
 */
export const getSupabaseClient = (): SupabaseClient => {
    if (!supabaseInstance) {
        supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
            },
        });
    }
    return supabaseInstance;
};

/**
 * Check if Supabase connection is working
 * Returns true if we can reach the server (even if query fails due to permissions)
 */
export const checkSupabaseConnection = async (): Promise<boolean> => {
    try {
        const client = getSupabaseClient();

        // Use auth.getSession() - doesn't require any table/RLS setup
        const { error } = await client.auth.getSession();

        // If we get here without throwing, connection works
        // (error just means no session, not a connection failure)
        return true;
    } catch (e: unknown) {
        const error = e as Error;

        if (error.message?.includes('Failed to fetch')) {
            console.error(
                'Supabase Connection Blocked: Request to supabase.co was blocked. ' +
                'This is usually caused by ad blockers (uBlock, Brave Shields, etc.). ' +
                'Please disable them for this site.'
            );
        } else {
            console.error('Supabase Connection Error:', error.message);
        }

        return false;
    }
};

/**
 * Reset the client instance (useful for testing or re-initialization)
 */
export const resetSupabaseClient = (): void => {
    supabaseInstance = null;
};

// Export the client directly for convenience
export const supabase = getSupabaseClient();

