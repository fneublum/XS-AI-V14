-- Restore the sharedWith column on customers so the v2 drawer can save
-- cross-company visibility (and, more importantly, so any PATCH that
-- includes `sharedWith` in the payload doesn't 400 on the whole
-- request — which was silently swallowing unrelated writes like
-- email3). Idempotent.
alter table customers add column if not exists "sharedWith" text[] default '{}';
