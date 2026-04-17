# XS-ERP — Cloud Run container
#
# Multi-stage build:
#   1) Node builds the Vite app (static assets in /app/dist).
#   2) nginx:alpine serves those assets on port 8080.
#
# VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are baked at build time via
# Docker build args. Secrets (GEMINI_API_KEY, etc.) are NOT in this image —
# they live server-side in Supabase Edge Function secrets (Phase 1c).
#
# Build:   gcloud builds submit --tag gcr.io/xs-erp/xs-erp-app
# Deploy:  gcloud run deploy xs-erp --image gcr.io/xs-erp/xs-erp-app \
#            --region us-central1 --port 8080 --allow-unauthenticated \
#            --service-account xs-erp-runtime@xs-erp.iam.gserviceaccount.com

# ── Stage 1: build ──────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# Copy package manifests + .npmrc first so the npm install layer caches
# on code-only changes. `.npmrc` carries `legacy-peer-deps=true` — it
# must land before the `npm install` step or peer-dep resolution fails.
COPY package.json package-lock.json* .npmrc* ./

# `npm install` (not `ci`) — tolerant of lock drift while package.json
# stabilises. Peer-deps handled by the copied `.npmrc`. Swap back to
# `npm ci` once the lockfile and peer deps are clean.
RUN npm install --no-audit --no-fund

# Copy the rest of the source.
COPY . .

# Vite build args — passed in via `gcloud builds submit --substitutions`
# or `docker build --build-arg`. Non-secret (anon key is public by design).
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

RUN npm run build

# ── Stage 2: serve ──────────────────────────────────────────────────────
FROM nginx:alpine

# Replace the default site config with our SPA-aware + CSP-setting one.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the built assets. Vite emits to dist/.
COPY --from=build /app/dist /usr/share/nginx/html

# Cloud Run expects the container to listen on $PORT (defaults to 8080).
# nginx.conf hardcodes listen 8080 — Cloud Run's default — and we expose it.
EXPOSE 8080

# nginx:alpine has a correct default CMD, but make it explicit so a future
# base-image change doesn't surprise us.
CMD ["nginx", "-g", "daemon off;"]
