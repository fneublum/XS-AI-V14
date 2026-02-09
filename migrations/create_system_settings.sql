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

-- Create policy to allow authenticated users to read/write
CREATE POLICY "Allow all authenticated users to manage settings"
    ON system_settings
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Create index for faster key lookups
CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(key);
