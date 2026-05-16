---
name: Track M2 B2B Renewal + Bundle Upsell
description: B2B-Renewal-Cadence (30/14/7/1d) + curriculum_upsell_paths SSOT + 2 Producer-Crons + Renewal-Pipeline-Cockpit-Card.
type: feature
---

# Track M2 — B2B Renewal Pipeline + Bundle-Upsell-Paths (2026-05-16)

## Scope
Erweitert Track M1 um zwei monetarisierungs-kritische Loops, die in M1 bewusst offen blieben:
- B2B-Lizenz-Renewal-Kadenz (4-stufig: 30/14/7/1 Tag vor Ablauf)
- Bundle/Cross-Sell auf Basis explizit definierter `curriculum_upsell_paths`

## Neue Intents
- `org_seat_expiring_14d` (sensitive, prefer)
- `org_seat_expiring_7d` (sensitive, prefer, escalation)
- `org_seat_expiring_1d` (critical, prefer, fatigue-bypass) — kritisch, weil Lernzugang erlischt
- `org_seat_expiring_30d` aus M1 unverändert

## notification_jobs.kind
Erweitert um `org_seat_expiring_critical` (T-1) zusätzlich zu `org_seat_expiring` aus M1.

## curriculum_upsell_paths
- SSOT-Tabelle (source→target, weight, reason, enabled), UNIQUE pro (source,target), CHECK source≠target.
- RLS admin-only read; CRUD via `admin_get_curriculum_upsell_paths` + `admin_upsert_curriculum_upsell_path`.
- Producer skippt User mit aktivem `learner_course_grants` auf Target.

## Producer
- `fn_emit_b2b_renewal_intents(dry_run)` — service_role. Pro `org_license` mit `ends_at ∈ [30±2|14±1|7±1|1±1]d` + `status=active` + `cancel_at_period_end=false` → 1 Job pro Owner/Admin der Org. Dedupe-Key: `<intent>:<license_id>:<user_id>:<date>`.
- `fn_emit_bundle_upsell_intents(dry_run)` — service_role. JOIN über `curriculum_upsell_paths × learner_course_grants(source) × NOT EXISTS(target)`.
- Crons:
  - `b2b-renewal-intent-producer-hourly` (`23 * * * *`)
  - `bundle-upsell-producer-4h` (`41 */4 * * *`)

## Renewal-Pipeline SSOT
- `v_b2b_renewal_pipeline` (service_role only) — Lizenzen mit `ends_at-today ≤ 60d`, mit `risk_level` (≤7 critical / ≤14 high / ≤30 medium / sonst low) + Sitzplatz-Auslastung.
- `admin_get_b2b_renewal_pipeline()` (Admin-Gate) für UI.
- UI: `B2bRenewalPipelineCard` (HealCockpitPage, Notification-Sektion direkt nach `NotificationRevenueAttributionCard`).

## Smoke
`admin_smoke_b2b_renewal_pipeline()` validiert 5 Intents + beide Producer im Dry-Run-Pfad.

## Bewusste Auslassungen
- Stripe-Subscription-Cancel-Reverse: M2 setzt nur Jobs auf `ends_at`. Wenn ein Kunde verlängert, läuft `ends_at` einfach weiter; Job bleibt aktiv aber `policy_resolver` (Track 2.5) suppresst, sobald `cancel_at_period_end=false` + neue Periode.
- Owner-Reporting-Webhook (E-Mail-Digest pro Org) → Track M3.
- Upsell-Path-Discovery (automatisch aus Co-Purchase-Mustern) → Track M3.

## Files
- Migration: `supabase/migrations/<ts>_*.sql`
- UI: `src/components/admin/heal/cards/B2bRenewalPipelineCard.tsx`
