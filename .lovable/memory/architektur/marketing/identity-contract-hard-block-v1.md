---
name: Identity-Contract Hard-Block für conversion_events (P0)
description: BEFORE INSERT Trigger blockt strict events ohne package_id mit ERRCODE 23514. Whitelist via metadata.allow_missing_package_id|smoke_test|simulation. Audit via RAISE WARNING + best-effort Tabelle conversion_event_violations (admin_get_conversion_event_violations RPC).
type: feature
---

# Identity-Contract Hard-Block v1 (2026-05-02)

## Schutzregel
Strict events MÜSSEN `package_id` haben — write-time enforcement, keine Soft-Fixes mehr.

## Strict Event-Liste
- `checkout_started`
- `checkout_complete` (kanonisch laut SSOT v1)
- `checkout_completed` (Legacy-Alias, ebenfalls geblockt)
- `lead_capture_submitted`
- `quiz_started`
- `quiz_completed`

## Whitelist (3 Bypass-Wege)
1. `metadata.allow_missing_package_id = true` → expliziter Opt-Out (z.B. `lead_magnet_generic`)
2. `metadata.smoke_test = true` → E2E-Tests
3. `metadata.simulation = true` → Audit-Simulator

`lead_magnet_view` ist NICHT strict (bewusst, um unmatched-Drop messbar zu halten).

## Audit
- `RAISE WARNING 'IDENTITY_CONTRACT_VIOLATION_AUDIT ...'` → erscheint im Postgres-Log (überlebt Rollback).
- `conversion_event_violations`-Tabelle: best-effort Insert vor RAISE EXCEPTION (wird beim Block-Rollback verworfen, bleibt aber als Schema für zukünftige Out-of-Transaction-Logger via pg_net).
- Lese-RPC: `admin_get_conversion_event_violations(p_hours, p_limit)` mit has_role-Gate.

## Producer-Status (verifiziert 2026-05-02)
- `LeadQuizRunner.tsx` → quiz_*/lead_capture_submitted via emitFunnelEvent mit packageId aus quizBundleMap (Strict Event SSOT v1).
- `stripe-webhook` → emitCheckoutCompleteEvent helper resolved package_id aus product_id→curriculum_id→published package.
- `track-funnel-event` Edge → server-side Validation bereits aktiv.
- `create-product-checkout` → server-side checkout_started Insert mit resolved package_id.

## ERRCODE
`23514` (check_violation) — clients können gezielt fangen.

## Migrationen
- `supabase/migrations/20260502173051_*.sql` — Trigger + Audit-Tabelle + Admin-RPC
- `supabase/migrations/20260502173214_*.sql` — Audit via RAISE WARNING (Rollback-resistent)

## Verifizierte Tests
- ✅ Negativ-Test: `INSERT quiz_started` ohne package_id → ERRCODE 23514
- ✅ Positiv-Test: `INSERT quiz_started` mit `smoke_test:true` → durchgelassen + sofort gelöscht
- ✅ Bestehende Producer: 0 Drift in den letzten 5 Min nach Deploy

## Was passiert bei Verletzung
1. Postgres-Log bekommt WARNING-Eintrag mit event_type/session/user/metadata
2. Insert wird mit ERRCODE 23514 abgelehnt
3. Clients (Edge Function track-funnel-event) returnen 400 an den Browser
4. UI blockiert den User NICHT (tracking ist fire-and-forget)

## Nächste Schritte
- Path D: Landing Profiles Bulk-Backfill (45 published Pakete ohne Persona-Profil)
- Path C: Heatmap-UI auf v_data_holes_ssot
