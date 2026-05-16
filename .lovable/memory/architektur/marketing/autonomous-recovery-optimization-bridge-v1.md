---
name: Autonomous Recovery & Optimization Bridge v1 (Bridge 11)
description: Self-improving layer — detects ineffective interventions/curriculum drift/cohort anomalies and applies guarded auto-tuning actions within SSOT bounds
type: feature
---

## Scope
Übergang von „System empfiehlt Maßnahmen" → „System optimiert sich teilweise selbst" — strikt innerhalb registrierter Guardrails.

## SSOT Tables
- `optimization_guardrails` (guardrail_key UNIQUE, scope, rule_type [hard_block|requires_approval|soft_warning], enabled). Seed: 3 hard_block (no_curriculum_rewrite, no_free_content_generation, no_unverified_exam_logic) + 4 weichere Regeln.
- `system_optimization_events` (event_type, scope, target_ref jsonb, severity, signals, confidence, status [detected|queued|acted_on|dismissed|blocked_by_guardrail]).
- `auto_tuning_actions` (source_event_id, action_type, scope, target_ref, proposed_change, guardrail_key FK, requires_approval, status [proposed|approved|applied|reverted|blocked|rejected]).

Alle RLS-on, service_role full + admin SELECT via `has_role`.

## Views (service_role only)
- `v_failed_intervention_clusters` — auf `intervention_effectiveness_scores` (pass_rate_lift_pp<5, sample_size≥10), severity-Mapping CRITICAL/HIGH/MEDIUM/LOW.
- `v_curriculum_drift_patterns` — Window-Lag auf `cohort_snapshots` (curriculum, 30d).
- `v_system_optimization_candidates` — UNION der zwei Quellen, mappt auf `system_optimization_events`-Format.

## RPCs
- `fn_detect_optimization_candidates()` (service_role): scannt Candidates-View, inserted Events idempotent (7d Dedupe per event_type+target_ref). Audit `optimization_candidate_detected`.
- `fn_apply_auto_tuning_action(uuid)` (service_role): enforced Guardrail — hard_block → status=blocked, requires_approval & nicht approved → noop. Sonst applied + resolved Event. Audit `auto_tuning_action_applied`.
- `admin_get_autonomous_optimization_summary()` — Events/Actions/Guardrails-Summary 30d, has_role gated.
- `admin_get_auto_tuning_actions(p_limit, p_status)` — paginated, has_role.
- `admin_approve_auto_tuning_action(uuid, p_notes)` — markiert approved + ruft `fn_apply_auto_tuning_action`. Audit `auto_tuning_action_approved`.
- `admin_revert_auto_tuning_action(uuid, p_reason)` — reason≥3 chars. Audit `auto_tuning_action_reverted`.

## UI
`AutonomousOptimizationCard` im HealCockpit Diagnostics-Tab (unter TrainerIntelligenceCard).
- KPI-Grid (Events 30d, Detected, Critical, Acted-on, Guardrail-Blocked, Actions-Statuscounts)
- Guardrail-Liste mit Badge-Klassifizierung (hard_block destructive, requires_approval default, soft_warning outline)
- Action-Table mit Approve / Revert (Reason-Prompt)

## Audit-Trail (auto_heal_log)
- `optimization_candidate_detected`
- `auto_tuning_action_applied` | `auto_tuning_action_approved` | `auto_tuning_action_reverted`

## Guardrail-Invarianten (HARD)
1. Kein Curriculum-Rewrite (`no_curriculum_rewrite`).
2. Keine freie Content-Erzeugung (`no_free_content_generation`).
3. Keine ungeprüfte Prüfungslogik (`no_unverified_exam_logic`).

Actions mit diesen Guardrail-Keys werden direkt geblockt. Andere Scopes (Intervention-Downrank, Tutor-Mode-Block, Rescue-Reweighting, NBA-Adjust) sind erlaubt mit Approval/Sample-Size-Gates.

## Erste Welle
- Detection-Cron NOCH NICHT live — manuelle Trigger via `fn_detect_optimization_candidates()`. Cron folgt nach 24h Beobachtung der Candidate-Volumina.
