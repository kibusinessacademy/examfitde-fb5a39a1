---
name: Post-Purchase Activation Cut 1b
description: Completion-Loop /willkommen→Diagnose→/willkommen/aha→Lernplan. SSOT v2 mit minicheck_started/completed/tutor_feedback/lernplan_started. AI Coach via welcome-weakness-coach (Gemini Flash).
type: feature
---

# Post-Purchase Activation Cut 1b — First-Value Completion Loop (2026-05-18)

## Was anders ist vs Cut 1a
- 1a misst Sichtbarkeit (post_purchase_landing_view → first_question).
- 1b misst echten Aha: `welcome_seen → minicheck_started → minicheck_completed → tutor_feedback_received → lernplan_started`.
- TTFV neu = paid → LEAST(first_minicheck_completed, first_tutor_feedback).

## Bausteine
- RPC `learner_get_welcome_context(_order_id uuid)` — resolved Grant+Paket+Curriculum serverseitig, fallback newest active grant. Authenticated only.
- View `v_post_purchase_activation_ssot` (DROP+RECREATE, service_role only) + Summary-RPC `admin_get_post_purchase_activation_summary` mit `completion_rate_pct`, `tutor_feedback_rate_pct`, `lernplan_rate_pct` + 4 `dropoffs`.
- Edge fn `welcome-weakness-coach` (JWT, Lovable AI Gateway, model `google/gemini-2.5-flash`): liest `v_user_weakness_map`, 4-Sätze-Coach-Summary mit Fallback wenn Gateway fehlt.
- `/willkommen` neu: ruft `learner_get_welcome_context` (8×1.5s Polling), CTA „Diagnose starten" → `/exam-trainer?curriculum=...&mode=diagnostic&from=welcome` + emittiert `minicheck_started`.
- `/willkommen/aha` neu: ruft `welcome-weakness-coach`, zeigt Coach-Text + Top-3-Schwächen, CTA „Lernplan starten" → `/lernplan?curriculum=...&from=welcome` + emittiert `lernplan_started`.
- `useMiniCheckMasterySync`: feuert `minicheck_completed` nach Sync, auto-redirect zu `/willkommen/aha` wenn URL-Param `from=welcome`.
- Admin-Card v2 zeigt 6-Stage-Funnel + 4 Dropoff-KPIs + TTFV-Completed-p50/p90.

## Events (additiv im constraint, keine Removal)
welcome_seen, minicheck_started, minicheck_completed, tutor_feedback_received, lernplan_started

## Baseline 2026-05-18
86 grants im View, 0 mit welcome_seen / minicheck_completed (Cut 1b just shipped, instrument ab jetzt).

## Out-of-scope
- Persona-spezifische Coach-Tonalität (kommt mit Cut 1c)
- Lernplan-Page Customization für from=welcome
- Drop-off-Alerts/Heals (Cut 1d)
