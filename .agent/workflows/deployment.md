---
description: Deploy the X-Solution AI Business Platform to Google App Engine
---

# Deployment Workflow

Follow these steps to deploy a new version of the application.

## 1. Update Version Number
   - Update the version in `package.json`.
   - Update the version in `src/pages/Login.tsx`.

## 2. Sync Files (CRITICAL)
   The project has duplicate file structures. **Always sync these files before building:**
   ```bash
   # Sync Login.tsx from src to root pages
   cp src/pages/Login.tsx pages/Login.tsx
   
   # Sync CustomerPortal.tsx from root pages to src
   cp pages/CustomerPortal.tsx src/pages/CustomerPortal.tsx
   ```

## 3. Clean and Build
   Always delete old build artifacts before building:
   // turbo
   ```bash
   rm -rf dist node_modules/.cache && npm run build
   ```

## 4. Deploy to Google App Engine
   Deploy with the `--quiet` flag:
   // turbo
   ```bash
   gcloud app deploy --quiet --project=xs-erp
   ```
   
   **If hit 210 version limit:** Delete old versions first:
   ```bash
   gcloud app versions list --format="value(id)" --sort-by="last_deployed_time" --limit=5
   gcloud app versions delete <version_ids> --quiet
   ```

## 5. Verify Deployment
   - Visit: https://xs-erp.appspot.com
   - **Hard Refresh**: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
   - If still seeing old version, try **Incognito/Private window**
   - Verify the version number on the Login page matches your update

## Quick One-Liner (after updating versions)
```bash
cp src/pages/Login.tsx pages/Login.tsx && cp pages/CustomerPortal.tsx src/pages/CustomerPortal.tsx && rm -rf dist && npm run build && gcloud app deploy --quiet
```
