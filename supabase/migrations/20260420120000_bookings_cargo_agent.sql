-- Agent portal — add a nullable `cargoAgent` text column to bookings so
-- a logged-in Cargo Agent user can see only their own bookings via the
-- /agent-portal route. Mirrors the freight_quotes.agent_name pattern
-- (text, not FK) for consistency with the rest of the logistics tables.
--
-- Idempotent. Safe to apply on deployments that predate the portal —
-- existing bookings get NULL and are simply invisible to agent users
-- until someone tags them.

alter table bookings
  add column if not exists "cargoAgent" text;

create index if not exists bookings_cargo_agent_idx
  on bookings ("cargoAgent");
