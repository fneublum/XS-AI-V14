# Dropbox Save — One-time setup

The "Save to Dropbox" row action on the Invoices & docs page pushes the
Invoice PDF, Packing List PDF, and BOL into

```
/Desktop/EC4 COMEX/3 SHIPPED WITH BL/<first customer name> - CI<invoice#>/
```

inside the EC4 Dropbox account. The credentials live server-side in the
`system_settings` table; the Edge Function `dropbox-upload` reads them
with the service role key and is the only path that can ever see them.

## 1. Register a Dropbox app

1. Sign into the EC4 Dropbox account.
2. Go to https://www.dropbox.com/developers/apps and click **Create app**.
3. Pick:
   - **API**: "Scoped access"
   - **Type of access**: "Full Dropbox" (we need to reach `/Desktop/...`)
   - **Name**: e.g. `xs-erp-delivery-docs`
4. On the app settings page, **Permissions** tab, enable:
   - `files.content.write` — required for upload
   - `files.metadata.write` — required for create_folder
   - `files.metadata.read` — useful for future "list saved" features
5. Click **Submit** at the bottom of Permissions (Dropbox separates permission edits from app settings).
6. Back on **Settings**:
   - Copy the **App key** and **App secret**.
   - Under **OAuth 2**, **Access token expiration**: set to **No expiration** (so the refresh token never quietly stops working) OR leave the default and rely on refresh.
   - Under **Allowed redirect URIs**: add `http://localhost/oauth-noop` (we'll only do the OAuth handshake once via a local script).

## 2. Get a refresh token (one-time)

Dropbox's refresh-token flow needs a one-time authorization code exchange. Easiest way is a 3-step manual flow:

### Step 2a — Authorization URL

Open this URL in a browser logged into the EC4 Dropbox account (replace `<APP_KEY>`):

```
https://www.dropbox.com/oauth2/authorize?client_id=<APP_KEY>&response_type=code&token_access_type=offline&redirect_uri=http://localhost/oauth-noop
```

- `token_access_type=offline` is the magic — without it, you get only an access token, no refresh token.
- After you click Allow, Dropbox redirects to a 404'd `localhost` URL. That's fine — grab the `code=...` value from the URL bar.

### Step 2b — Exchange code for refresh token

Run locally (replace `<APP_KEY>`, `<APP_SECRET>`, `<CODE>`):

```bash
curl https://api.dropboxapi.com/oauth2/token \
  -d code=<CODE> \
  -d grant_type=authorization_code \
  -d client_id=<APP_KEY> \
  -d client_secret=<APP_SECRET> \
  -d redirect_uri=http://localhost/oauth-noop
```

Response contains:

```json
{ "access_token": "...", "refresh_token": "...", "expires_in": 14400, ... }
```

Save the **refresh_token**. It's the long-lived secret.

## 3. Store credentials in Supabase

Open the Supabase SQL editor and run (replace the three placeholders):

```sql
insert into system_settings (key, value)
values (
  'dropbox_credentials',
  jsonb_build_object(
    'appKey',       '<APP_KEY>',
    'appSecret',    '<APP_SECRET>',
    'refreshToken', '<REFRESH_TOKEN>',
    'rootPath',     '/Desktop/EC4 COMEX/3 SHIPPED WITH BL'
  )
)
on conflict (key) do update set value = excluded.value;
```

`rootPath` is optional — omit it and the Edge Function uses the default `/Desktop/EC4 COMEX/3 SHIPPED WITH BL`.

The `system_settings` RLS policy (added in `20260510120000_lockdown_system_settings.sql`) denies any client session from reading keys that contain `credential`/`secret`/`token`/etc., so the value is server-only.

## 4. Deploy the Edge Function

```bash
supabase functions deploy dropbox-upload --project-ref qfskvevighylzzmyiwre
```

No env vars to set — the function reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the platform defaults.

## 5. Test

In the app, hit the Invoices & docs page → click the cloud-upload icon
on any invoice row that has a BOL attached. The icon spins; on success,
a toast shows the folder name and file count. Check Dropbox: the new
subfolder should contain three files.

### Failure modes

- **"Upload the Bill of Lading first"** — the row action requires a BOL on the invoice. Use the BOL upload in the Delivery Docs modal first.
- **"Dropbox is not configured"** — the `system_settings` row is missing or its value doesn't have `appKey`/`appSecret`/`refreshToken`.
- **"Dropbox token refresh failed"** — usually the app secret is wrong or the refresh token was revoked. Redo Step 2 to get a new refresh token.
- **403 / "missing_scope" from Dropbox upload** — the app's Permissions tab is missing `files.content.write`. Add it and re-Submit; existing refresh tokens are invalidated after a permission change, so redo Step 2.
- **"Forbidden" (403 from the Edge Function)** — the caller's JWT isn't valid (`app-jwt-signing-secret` mismatch with auth-issue). Re-login.

## Rotating the refresh token

Same as Step 2 — issue a new code, exchange, then re-run the `insert ... on conflict` SQL in Step 3 with the new value. Old tokens are still valid until you revoke the app from the Dropbox account's connected-apps page.
