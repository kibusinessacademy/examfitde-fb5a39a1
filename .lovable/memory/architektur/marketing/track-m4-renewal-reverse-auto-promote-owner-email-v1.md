---
name: Track M4 Renewal Reverse + Auto-Promote + Owner-Digest Email
description: Schließt M2/M3-Lücken — Stripe-Renewal-Reverse via Trigger auf org_licenses, Auto-Promote Upsell-Suggestions, Owner-Digest Email-Render+Send via send-org-owner-digest.
type: feature
---
# Track M4 — Monetization Closure (2026-05-16)

## Scope
Schließt 3 bewusste Auslassungen aus M2/M3:
1. **Stripe-Renewal-Reverse** — Trigger `trg_m4_reverse_renewal_notifications` auf `org_licenses` AFTER UPDATE OF (cancel_at_period_end, status, ends_at). Drei Reverse-Szenarien: `renewal_reversed_cancel_undone`, `renewal_reversed_status_reactivated`, `renewal_reversed_ends_at_extended` (>7d Verlängerung UND neuer ends_at >32d). Supprimiert pending `org_seat_expiring*` Jobs für alle Owner/Admins der Org mit `payload.license_id = NEW.id`. EXCEPTION-safe (Trigger blockt nie das UPDATE). Audit `auto_heal_log.action_type='m4_renewal_reverse'`.
2. **Auto-Promote Upsell** — `fn_auto_promote_upsell_suggestions(min_confidence=0.15, min_support=5, min_lift=1.2)` promotet `curriculum_upsell_path_suggestions.status='pending'` zu aktiven `curriculum_upsell_paths` (ON CONFLICT UPDATE enabled=true, weight=max). Bestehende aktive Path → suggestion → 'superseded'. Cron `upsell-auto-promote-weekly` Mo 04:45 (nach Discovery 04:15).
3. **Owner-Digest Email-Channel** — `fn_flip_owner_digest_jobs_to_email()` flippt pending `kind=org_owner_digest` von push→email. Edge `send-org-owner-digest` claimt batch=25, resolved Email via auth admin, rendert HTML (periodLabel, active_licenses, seats utilization, expiring_30d, learners, dashboard CTA), sendet via Resend (noreply@examfit.de), markiert delivered + auto-event `notification_opened`. Cron `owner-digest-email-flush-10min` ruft Flip+Edge alle 10min.

## SSOT
- `admin_get_track_m4_audit(window_hours=168)` — reverse events, auto-promote runs, email pending/delivered/failed.
- `admin_smoke_track_m4()` — verifiziert Trigger installed + Promote dry-run + Email-Flip.

## Bewusste Auslassungen (Track M5)
- Owner-Digest Open/Click-Tracking (Resend Webhook integration)
- Auto-Promote Threshold-Tuning per Persona/Geography
- Renewal-Reverse Re-Emit (wenn Customer doch wieder cancelt nach Reverse)

## Files
- Migration: `supabase/migrations/20260516_*.sql`
- Edge: `supabase/functions/send-org-owner-digest/index.ts`
- UI: `src/components/admin/heal/cards/TrackM4StatusCard.tsx` (HealCockpitPage nach UpsellDiscoveryCard)
