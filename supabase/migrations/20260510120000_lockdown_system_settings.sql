-- Lockdown for system_settings: this table holds a mix of non-secret app
-- settings (personas, workflow state) and secrets (Twilio creds, API keys,
-- signing tokens). The original migration shipped a permissive policy that
-- allowed every authenticated session to read every row — including the
-- credentials — once a user logged in.
--
-- Replace it with a key-pattern guard: client sessions can read/write only
-- rows whose key does NOT look like a secret. The service role bypasses
-- RLS, so Edge Functions still have full access for the credential rows.

DROP POLICY IF EXISTS "Allow all authenticated users to manage settings"
    ON system_settings;

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

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
