---
name: Post-Purchase Activation Cut 1a
description: SSOT-View + Admin-RPC + KPI-Card + /willkommen Landing für Post-Purchase-Funnel paid→login→session→question→lesson→exam mit TTFV p50/p90/p95.
type: feature
---

# Post-Purchase Activation Cut 1a (2026-05-18)

## SSOT
- View `public.v_post_purchase_activation_ssot` (service_role only).
  Quellen: `learner_course_grants` (paid_at = granted_at), `auth.users.last_sign_in_at`,
  `conversion_events` (post_purchase_landing_view/activation_started/course_open),
  `ai_tutor_sessions`, `exam_sessions`, `minicheck_attempts`, `exam_attempts`,
  `lesson_outcomes` (status IN completed/passed/mastered).
  Stages: paid → first_login → first_session → first_question → first_lesson_done → first_exam_started.
  Liefert time_to_*_sec + funnel_stage_reached + persona/track/package.
- RPC `admin_get_post_purchase_activation_summary(_window_hours int=720)` — SECURITY DEFINER, has_role(admin).
  Output: funnel-counts + ttfv_p50/p90/p95 + login/session/lesson/exam p50 + by_track + by_persona.

## Definition First Value
**Erste beantwortete Frage** (minicheck_attempts ODER exam_attempts.started_at) — NICHT Login, NICHT Dashboard-View.

## Events (conversion_events_event_type_v2_chk erweitert)
- `post_purchase_landing_view` — /willkommen geladen
- `activation_started` — User klickt eine der 3 Quick-Start-CTAs
- `first_learning_action` — reserviert (kein Producer in Cut 1a)
- `activation_completed` — reserviert (Cut 1b)

## UI
- `/willkommen` (`src/pages/checkout/WelcomePage.tsx`): Auth-Gate-safe Resume, polled neuestes active grant (bis zu 8×1.5s wegen Webhook-Latenz), drei Primär-CTAs (Diagnose-MiniCheck / Prüfungsmodus / Quick-Win) → `/exam-trainer?curriculum=...&mode=diagnostic`.
- `PostPurchaseActivationCard` in `/admin/growth` Dashboard-Tab: 24h/7d/30d-Switch, 6-Stage-Funnel mit Stage-Bars, KPIs (Käufer, First-Value-Rate, TTFV p50/p90, Exam-Start-Rate), Drilldowns Track + Persona.

## Stripe Wiring
- `create-product-checkout.success_url` → `${appUrl}/willkommen?order_id=...`
- Legacy `/checkout/success` → `<Navigate to="/willkommen?...">` (query-preserved).

## Baseline 2026-05-18
86 grants in View. Sample-Sample: alle bisherigen funnel_stage_reached='paid' (keine Activation-Events instrumentiert vor Cut 1a → erwartet).

## Nicht in Scope
- Activation-Heals / Dropoff-Alerts → Cut 1b
- Persona-spezifische Activation-Flows → Cut 1c
- Device-Type-Segmentierung (Mobile vs Desktop) → benötigt Device-Capture im /willkommen-Event → Cut 1b
