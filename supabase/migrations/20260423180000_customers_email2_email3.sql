-- Add secondary + tertiary email columns to customers so the
-- Customer drawer (Data → Customers) can capture them. Idempotent:
-- the customers table already had `email2` on some environments.
alter table customers add column if not exists "email2" text;
alter table customers add column if not exists "email3" text;
