#!/usr/bin/env bash
# CI-Einzeiler: Stripe B2C Smoke (Pfad 1 — paywall_variant)
#
# Lokal:
#   E2E_EMAIL=... E2E_PASSWORD=... \
#   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
#   ./scripts/stripe-smoke.sh
#
# Optional: BASE_URL (default https://examfitde.lovable.app)
#
# In CI:
#   gh workflow run stripe-smoke-b2c.yml
set -euo pipefail
: "${E2E_EMAIL:?E2E_EMAIL required}"
: "${E2E_PASSWORD:?E2E_PASSWORD required}"
: "${SUPABASE_URL:?SUPABASE_URL required}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY required}"
export BASE_URL="${BASE_URL:-https://examfitde.lovable.app}"

bunx playwright install --with-deps chromium >/dev/null
bunx playwright test --project=stripe-smoke
