# Shipment ETA auto-refresh — setup

The Edge Function `update-shipment-eta` (in `supabase/functions/`)
iterates every active invoice (in-transit window: bookingNumber set,
invoice within the last 120 days), reads a container number off the
invoice, asks a third-party tracker for the latest ETD/ETA, and
writes the new dates back onto the linked `bookings` row.

Once configured, Logistics Follow Up shows the freshest ETD/ETA every
morning without anyone touching it.

## 1. Pick a tracking provider

| Provider | Cost | Coverage | Setup time |
|---|---|---|---|
| **ShipsGo** ⭐ recommended | Pay-per-track (~$0.30–1.00) | All major carriers | ~5 min |
| **Maersk public API** | Free | Maersk-operated only (MAEU/MRKU/MSKU/POCU/SEAU prefixes) | ~10 min |
| **Vizion** | $99–$499/mo | All carriers | ~15 min (custom contract) |
| **Stub** | — | — | Useful for dry runs before signing up |

### ShipsGo (recommended)

1. Sign up at https://shipsgo.com — pick "Container Tracking".
2. From the dashboard, copy your **Auth Code** (under Account → API).
3. Add credits — Pay-as-you-go is the cheapest entry. ~$50 gets you ~100 lookups, enough for a year of EC4 daily refreshes if you only have a few in-transit at any time.

### Maersk public API

1. Sign up at https://developer.maerskline.com.
2. Subscribe to the **Track** product.
3. Copy your **Consumer Key**.

Note: Maersk only returns data for Maersk-operated containers. The function checks the container prefix and skips non-Maersk keys; if your fleet is mostly MSC/Hapag/CMA, Maersk-only coverage isn't useful.

## 2. Store credentials in Supabase

Run this in the SQL editor — replace the placeholders for whichever provider you picked.

### ShipsGo

```sql
insert into system_settings (key, value)
values (
  'shipment_tracker_credentials',
  jsonb_build_object(
    'provider', 'shipsgo',
    'config', jsonb_build_object(
      'authCode', '<YOUR_SHIPSGO_AUTH_CODE>'
    )
  )
)
on conflict (key) do update set value = excluded.value;
```

### Maersk

```sql
insert into system_settings (key, value)
values (
  'shipment_tracker_credentials',
  jsonb_build_object(
    'provider', 'maersk',
    'config', jsonb_build_object(
      'consumerKey', '<YOUR_MAERSK_CONSUMER_KEY>'
    )
  )
)
on conflict (key) do update set value = excluded.value;
```

### Stub (dry run — no actual provider call)

```sql
insert into system_settings (key, value)
values ('shipment_tracker_credentials', jsonb_build_object('provider', 'stub'))
on conflict (key) do update set value = excluded.value;
```

The row stays server-only — `system_settings.shipment_tracker_credentials` is RLS-locked away from client sessions because the key matches the `credential` regex policy added in `20260510120000_lockdown_system_settings.sql`.

## 3. Set the function's shared secret

The Edge Function authenticates incoming calls via a shared bearer token so a public URL can't be hammered by anyone who finds it. Pick any long random string:

```bash
supabase secrets set SHIPMENT_ETA_SHARED_SECRET=$(openssl rand -hex 32) \
  --project-ref qfskvevighylzzmyiwre
```

You'll need that same value in the cron SQL below — copy it out:

```bash
supabase secrets list --project-ref qfskvevighylzzmyiwre | grep SHIPMENT_ETA
```

## 4. Deploy the function

```bash
supabase functions deploy update-shipment-eta --project-ref qfskvevighylzzmyiwre
```

## 5. Smoke-test it

```bash
curl -X POST \
  https://qfskvevighylzzmyiwre.supabase.co/functions/v1/update-shipment-eta \
  -H "Authorization: Bearer <your-shared-secret>"
```

Expected response:

```json
{
  "ok": true,
  "summary": {
    "scanned": 47,
    "trackable": 32,
    "updated": 12,
    "unchanged": 18,
    "noProviderHit": 2,
    "noTrackingKey": 0,
    "errors": 0
  },
  "provider": "shipsgo",
  "ranAt": "2026-05-15T07:00:00.000Z"
}
```

| Field | Meaning |
|---|---|
| `scanned` | Total in-transit invoices in the window |
| `trackable` | Unique bookings with at least one usable tracking key |
| `updated` | Bookings whose `etd` or `eta` changed |
| `unchanged` | Provider returned a date that matches current |
| `noProviderHit` | Provider returned no data for this key |
| `noTrackingKey` | Invoice has no container/BL/booking we could use |
| `errors` | Tracker threw or DB write failed |

## 6. Schedule it (pg_cron)

Once 5 passes, schedule a daily run. The SQL below uses `pg_cron` + `pg_net` (both pre-installed on Supabase). Run once in the SQL editor:

```sql
-- Make sure the extensions are enabled (no-op if already on).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 07:00 UTC every day. Adjust the cron expression for your timezone.
select cron.schedule(
  'update-shipment-eta-daily',
  '0 7 * * *',
  $$
    select net.http_post(
      url := 'https://qfskvevighylzzmyiwre.supabase.co/functions/v1/update-shipment-eta',
      headers := jsonb_build_object(
        'Authorization', 'Bearer <YOUR_SHARED_SECRET>',
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    ) as request_id;
  $$
);
```

Replace `<YOUR_SHARED_SECRET>` with the value from Step 3.

To list / pause / delete the job later:

```sql
select * from cron.job;                                       -- list
update cron.job set active = false where jobname = 'update-shipment-eta-daily';  -- pause
select cron.unschedule('update-shipment-eta-daily');          -- delete
```

## 7. Watch it run

Supabase dashboard → Functions → `update-shipment-eta` → Logs. You'll see a line per run with the summary block. The function also logs each updated booking with the keys it used so you can diff against carrier emails if anything looks off.

## Adding more providers later

The function dispatches on `creds.provider` in [`trackContainer()`](../supabase/functions/update-shipment-eta/index.ts). To add a new carrier, write a new `trackXyz()` function that returns `{ etd, eta, source }` and append a `case 'xyz':` arm. The `system_settings` row gets the new provider name + config shape, no schema change needed.
