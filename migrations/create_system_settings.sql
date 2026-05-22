-- Create system_settings table for storing application settings like API credentials
CREATE TABLE IF NOT EXISTS system_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- system_settings is a mixed-purpose table: some keys hold non-sensitive
-- application configuration (personas, workflow state) that the client
-- reads/writes directly, while other keys hold secrets (API credentials,
-- bearer tokens, signing keys) that must never be exposed to the client.
--
-- The original policy was `USING (true) WITH CHECK (true)`, which allowed
-- any authenticated session to read or overwrite secret-bearing rows. The
-- policy below denies client access whenever the row's key matches any
-- secret-shaped pattern. The service role bypasses RLS by default, so
-- Edge Functions can still read and write every row.

-- Policy is intentionally NOT scoped `TO authenticated`. The client uses
-- the Supabase anon key (the app runs its own auth via the `users`
-- table, not Supabase Auth), so `auth.role()` is `anon` on every
-- request. A `TO authenticated` policy would deny every client read.
-- The service role (Edge Functions) bypasses RLS regardless.
CREATE POLICY "Allow non-secret settings"
    ON system_settings
    FOR ALL
    USING (key !~* '(credential|secret|token|api[_-]?key|password|client[_-]?secret|private[_-]?key)')
    WITH CHECK (key !~* '(credential|secret|token|api[_-]?key|password|client[_-]?secret|private[_-]?key)');

-- Create index for faster key lookups
CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(key);
