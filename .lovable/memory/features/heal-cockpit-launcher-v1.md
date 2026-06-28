---
name: Heal Cockpit Function Launcher v1
description: Top-of-page tile grid in /admin/heal that lists all heal actions (reaper, bulk, package, sellable, cleanup) with one-click run + confirm + last-run badge. Diagnostics-heavy cards relocated to /admin/heal/diagnostics.
type: feature
---

## What

Heal Cockpit (/admin/heal) restructured 2026-06-28:

1. **HealFunctionLauncher** (`src/components/admin/heal/HealFunctionLauncher.tsx`)
   - Tile grid (sm:2 lg:3 cols) grouped: Reaper · Bulk · Package · Sellable · Cleanup
   - Each tile: icon · label · 1-line hint · last-run badge (from `auto_heal_log`) · Run button
   - Run path: `AlertDialog` confirm → `runAdminOpsAction` / `supabase.rpc` / `supabase.functions.invoke`
   - Last-runs auto-refresh every 30s
2. **HealDiagnosticsPage** (`src/pages/admin/v2/HealDiagnosticsPage.tsx`)
   - New route `/admin/heal/diagnostics`
   - 6 tabs (Worker · Notifications · Tracks · Growth · SEO · Intelligence)
   - Hosts ~60 cards previously inlined in the cockpit
3. **Cockpit trimmed**: "Pakete heilen" section reduced from 50 cards → 10 critical.
   "Diagnostik" advanced-tab replaced with link to /admin/heal/diagnostics.
4. **admin-ops-actions fix**: `workspaceSnapshot` `.single()` → `.maybeSingle()` with
   404-fallback to stop "Cannot coerce to single JSON object" 500s.
5. **Internal-auth helper** (`supabase/functions/_shared/internal-auth.ts`):
   `requireInternalOrUser(req)` accepts either a valid User-JWT or
   `x-internal-secret == INTERNAL_CRON_SECRET` for cron-invoked workers.
6. **Smoke**: `node scripts/heal-launcher-smoke.mjs` writes
   `/tmp/heal-launcher-report.md`.

## Invariants

- Every Launcher run writes to `auto_heal_log` via the underlying RPC/edge fn
  (no new write paths).
- SSOT guards remain in place (Bulk-Publish clamped 24,90 € · 12 Mon · Cap 18).
- No KPI cards were deleted; relocation only.
