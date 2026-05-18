---
name: Post-Purchase Activation Cut 1c
description: Activation Assurance & First-Value Hardening. SSOT-View v_activation_assurance_ssot leitet current_stage/blocked_reason/is_stale ab. Admin-RPC admin_get_activation_assurance + ActivationAssuranceCard mit Stale-Drilldown. Pure Nudge-Planer (keine Mutation).
type: feature
---

# Post-Purchase Activation Cut 1c — Activation Assurance (2026-05-18)

## Was anders ist vs Cut 1b
- 1b instrumentiert den Flow (Events + 6-Stage-Funnel).
- 1c stellt sicher, dass **jeder einzelne Grant** in genau einer Stage steht, Blocker sichtbar werden und das Admin-Cockpit Stale-Aktivierungen meldet — vor jeder Notification-Logik.

## Bausteine
- **View `v_activation_assurance_ssot`** (service_role only): Top-of `v_post_purchase_activation_ssot`, exposes per Grant:
  - `current_stage` ∈ {grant_created, welcome_seen, first_minicheck_started, first_minicheck_completed, aha_completed, lernplan_started}
  - `missing_next_step`, `blocked_reason`
  - `first_value_at = LEAST(first_minicheck_completed_at, first_tutor_feedback_at)`
  - `minutes_since_grant`, `minutes_to_first_value`, `first_value_reached`
  - `is_stale_activation` per Stage-Timeout-Matrix:
    - >15 min ohne welcome_seen
    - >30 min ohne minicheck nach welcome
    - >30 min ohne aha nach minicheck_completed
    - >60 min ohne lernplan nach aha
    - >24 h ohne first_value
- **RPC `admin_get_activation_assurance(_window_hours int default 48)`** SECURITY DEFINER + `has_role(admin)` Gate. Returns totals_by_stage, stale_count, first_value_rate_pct, median_minutes_to_first_value, items (top 50, learner_ref = sha256-prefix, keine PII). Audit `activation_assurance_viewed` via `fn_emit_audit` (best-effort).
- **Audit-Contract** registriert (wenn `ops_audit_contract` existiert): `activation_assurance_viewed`, `activation_stale_detected`, `activation_nudge_planned`.
- **`ActivationAssuranceCard`** (Growth/Dashboard-Tab): 4 KPIs (Grants, First-Value-Rate, Median TTFV, Stale), Stage-Verteilung, Stale-Drilldown mit Nudge-Empfehlung pro Zeile. Reload-Button, Empty-State, 60s-Refetch.
- **`planActivationNudge(status)`** pure helper in `src/features/activation/`: liefert `nudge_type` ∈ {return_to_welcome, complete_aha, start_learning_plan, start_minicheck, none} + Audit-Payload. Keine Mutation, keine Notification (kommt in Cut 1d).

## Constraints / Guardrails
- View bleibt service_role-only — Frontend liest **nur** via Admin-RPC (Rule 17 / `ssot-guard`).
- learner_id wird hashed (`learner_ref = 'user_' || sha256-prefix`) — keine PII im Audit.
- Keine Notification, keine Mutation in 1c.

## Tests
- `src/features/activation/__tests__/planActivationNudge.test.ts`: 7 Tests grün (Stage-Routing, Empty-Stale, PII-Audit-Shape).

## Out-of-scope (→ Cut 1d)
- E-Mail/In-App-Nudges
- Auto-Recovery-Jobs für stale grants
- Personalisierte Coach-Tonalität pro Persona
