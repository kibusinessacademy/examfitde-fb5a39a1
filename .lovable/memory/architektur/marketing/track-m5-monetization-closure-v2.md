---
name: Track M5 Owner-Digest Tracking + Persona Tuning + Renewal Re-Emit
description: Schließt die 3 M4-Auslassungen — org_owner_digest_events (open/click via owner-digest-track edge), curriculum_upsell_promote_tuning + fn_auto_promote_upsell_suggestions_v2, trg_m5_reemit_after_reverse.
type: feature
---
# Track M5 — Monetization Closure v2 (2026-05-16)

## Scope
Closure für drei bewusste Auslassungen aus Track M4:

1. **Owner-Digest Open/Click-Tracking** — Schema-Erweiterung `org_owner_digests.tracking_token` + Tabelle `org_owner_digest_events` (digest_id, recipient, event_type ∈ open|click, link_url, user_agent, ip_hash). Edge `owner-digest-track` (verify_jwt=false) serviert 1×1-Pixel für `?type=open` und 302-Redirect für `?type=click&u=<url>`. Service-Role-RPC `admin_record_owner_digest_event` ist idempotent via UNIQUE(digest_id, recipient, event_type, link_url). Konsumiert wird das später durch `send-org-owner-digest` (Tracking-URLs einbauen — TODO M6).

2. **Auto-Promote Tuning pro Persona / Curriculum** — Tabelle `curriculum_upsell_promote_tuning` (persona, source_curriculum_id NULL=alle, min_confidence/min_support/min_lift, max_promote_per_run, enabled). Default-Row `__default__` mit 0.15/5/1.2/25. RPC `fn_auto_promote_upsell_suggestions_v2` walkt enabled-Tunings (spezifisch vor default), promotet per Tuning bis Cap, audit `m5_auto_promote_upsell_v2` mit per-Tuning Breakdown. Cron `upsell-auto-promote-v2-weekly` Mo 04:55 (nach v1 04:45).

3. **Renewal Re-Emit** — Trigger `trg_m5_reemit_after_reverse` auf `org_licenses` AFTER UPDATE OF (cancel_at_period_end, status, ends_at). Erkennt at-risk Transition (re-cancel / status drop / ends_at shortened). Wenn in den letzten 30d ein `m4_renewal_reverse`-Audit für dieselbe license existiert → re-enqueued frische `org_seat_expiring_critical`-Jobs für alle Owner/Admins der Org mit `payload.reemit=true`. EXCEPTION-safe. Audit `m5_renewal_re_emit`.

## SSOT
- `admin_get_track_m5_audit(p_window_hours=168)` — digest_tracking (opens/clicks/unique), auto_promote_v2 (runs/promoted), renewal_re_emit (events/jobs).
- `admin_smoke_track_m5()` — tuning_default_exists + reemit_trigger_installed + tracking_token_column.

## UI
- `TrackM5StatusCard.tsx` im `HealCockpitPage` nach `TrackM4StatusCard`. Buttons: Smoke + Run Promote v2 (manual).

## Bewusst nicht in M5
- Tracking-URLs in `send-org-owner-digest` Template einbauen (Edge-Function-Edit → Track M6).
- Resend-Webhook für bounce/complaint→suppressed_emails (Track M6).
- Auto-Promote Tuning UI-CRUD (M6, derzeit nur SQL-Edit).

## Files
- Migration: `supabase/migrations/2026051614*.sql`
- Edge: `supabase/functions/owner-digest-track/index.ts` (+ config.toml verify_jwt=false)
- UI: `src/components/admin/heal/cards/TrackM5StatusCard.tsx` (HealCockpit nach M4)
