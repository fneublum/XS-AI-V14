-- Phase 3C — Purchase & cost wizard
--
-- Adds columns so the v2 Source offer → PO → Landed cost flow can
-- round-trip without losing information. Until this migration is
-- applied on a deployment, the wizard still works but these fields
-- can't be persisted on the row (they'd fail the PostgREST schema
-- cache check). The code in v2 handles both states gracefully.

alter table supplier_offers
  add column if not exists "freightType" text;

alter table purchase_orders
  add column if not exists "loadingLocation" text,
  add column if not exists "originPort"      text,
  add column if not exists "destinationPort" text,
  add column if not exists "freightType"     text,
  -- Landed-cost header (written by step 3).
  add column if not exists "fxRateToUsd"                numeric,
  add column if not exists "freightPickupTotalUsd"      numeric,
  add column if not exists "freightOceanTotalUsd"       numeric,
  add column if not exists "freightDeliveryTotalUsd"    numeric,
  add column if not exists "insuranceTotalUsd"          numeric,
  add column if not exists "portClearanceTotalUsd"      numeric,
  add column if not exists "dutyRatePct"                numeric,
  add column if not exists "shipmentType"               text,
  add column if not exists "marginPct"                  numeric,
  add column if not exists "landedGrandUsd"             numeric;
