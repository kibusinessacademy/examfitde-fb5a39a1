---
name: Track 2.5 Policy Enforcement + Learner Trust
description: Adaptive notification policies enforced at dispatch time. Audit + Learner-Trust + Admin Impact Funnel + Regression Smoke.
type: feature
---

# Track 2.5: Policy Enforcement + Learner Trust Layer (v1)

## Ziel
Adaptive Policies (Track 2.4) wirken jetzt im echten Versandpfad — kontrolliert, erklärbar, auditierbar.

## Architektur
- **notification_dispatch_decisions** (append-only): pro Job-Versand 1 Row mit `strategy`, `effective_action` ∈ {allowed, suppressed, delayed, channel_changed}, `reasons`, `safety_class`, `delay_seconds`.
- **fn_enforce_notification_policy(p_job_id)** (service_role): ruft `resolve_notification_policy`, mappt Strategy → Action:
  - suppress → state='suppressed', suppression_reason ergänzt mit 'policy_suppress'
  - cooldown → state='pending', scheduled_for = max(now+6h, scheduled_for) → delayed
  - downrank → channel_changed (single-channel-Realität: push only, daher allowed mit audit-flag)
  - prefer/neutral → allowed
- **send-learner-push** ruft Enforcement vor jedem Send. suppressed/delayed → skip + Zähler (response.suppressed, response.delayed).

## Learner Trust
- `learner_get_recent_notifications` erweitert um `policy_strategy`, `policy_action`, `policy_reasons` (LEFT JOIN LATERAL auf neueste Decision pro Job). Wird auf `/app/benachrichtigungen` für „Warum wurde ich (nicht) erinnert?" gerendert.

## Admin
- **admin_get_policy_impact_funnel(window_hours)**: per-intent total/allowed/suppressed/delayed/channel_changed + suppression_rate.
- **PolicyImpactFunnelCard** im HealCockpit Diagnostics-Tab mit Window-Switch + Smoke-Trigger.

## Regression Smoke
`admin_smoke_policy_enforcement()` — 6 Checks:
1. critical_safety_floor_exam_countdown — kein downrank/cooldown/suppress
2. critical_safety_floor_payment_reminder — dito
3. missing_intent_suppressed — Resolver gibt suppress bei unbekanntem Intent
4. persona_fallback_resolves — azubi-Lookup fällt auf 'all' zurück
5. dry_run_never_flips — 2× dry_run produziert nie guard_action='flip'
6. cooldown_column_present — Schema-Drift-Guard

## Files
- supabase/migrations/<2026-05-16-track-2-5>.sql
- supabase/functions/send-learner-push/index.ts (Enforcement-Hook)
- src/components/admin/heal/cards/PolicyImpactFunnelCard.tsx
- RPCs: fn_enforce_notification_policy, admin_get_policy_impact_funnel, admin_smoke_policy_enforcement, learner_get_recent_notifications v2

## Was bewusst NICHT gebaut wurde
- Multi-Channel-Routing (Email/SMS) — kommt mit Track 2.6/2.7
- Resolver darf Engine nicht blind schlagen: Safety-Floor wird zusätzlich in `resolve_notification_policy` enforced (Defense-in-Depth), Resolver clampt aber NIE auf weniger restriktiv als die gespeicherte Policy.
