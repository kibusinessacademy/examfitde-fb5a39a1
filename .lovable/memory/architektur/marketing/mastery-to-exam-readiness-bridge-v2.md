---
name: mastery-to-exam-readiness-bridge-v2
description: Bridge 2 P0 — SSOT v_exam_readiness_v2 mit Coverage×Confidence×Stability×Simulation Formel, LF-Gap-Cap, Auto-Recompute via Trigger, Rescue-Intervention für AT_RISK/CRITICAL
type: feature
---

# Mastery → Exam Readiness v2 (Bridge 2, P0)

## Formel
`readiness_score = coverage × confidence × stability × simulation × 100`

- **coverage** = rated_competencies / total_competencies (0..1)
- **confidence** = AVG(mastery_score) / 100
- **stability** = clamp(recent_30d_count / rated_count, min=0.5, max=1.0)
- **simulation** = AVG(letzte 3 exam_attempts.score/total)/100, default 0.7 wenn 0 Sims

## Verdict
- `NOT_STARTED` rated_count=0
- `READY` ≥85 UND lf_gap_count=0
- `PARTIAL` 70–84 ODER (≥85 mit LF-Gap-Cap)
- `AT_RISK` 55–69
- `CRITICAL` <55

LF-Gap-Cap: jedes Learning-Field mit AVG(mastery)<50 verhindert READY.

## Komponenten
- `v_exam_readiness_v2` (SSOT, service_role only)
- `fn_exam_readiness_v2(user_id, curriculum_id)` (SECURITY DEFINER, owner-only oder admin) → schreibt Snapshot in `learner_readiness_history`
- `learner_readiness_history` (RLS: user reads own)
- `admin_get_readiness_distribution(curriculum_id NULL)` Cockpit-RPC
- `fn_detect_readiness_sla_breach()` — AT_RISK/CRITICAL ohne Intervention >24h → enqueue `learner_intervention_dispatch`

## Orchestrator
- `trg_mastery_enqueue_readiness` AFTER INSERT/UPDATE auf `user_competency_mastery`
- `trg_exam_attempt_enqueue_readiness` AFTER completed_at set auf `exam_attempts`
- Beide → `fn_enqueue_readiness_recompute()` mit 30s-Debounce
- Worker dispatcht bei AT_RISK/CRITICAL automatisch `learner_intervention_dispatch` (rescue email via email_delivery_queue) und für PARTIAL/AT_RISK/CRITICAL `learner_next_best_step_generate` (v1 signal-only)

## Job-Types (ops_job_type_registry, lane=learner_readiness)
- `learner_readiness_recompute`
- `learner_intervention_dispatch`
- `learner_next_best_step_generate`

## Worker & Cron
- Edge: `learner-readiness-worker` (claim 25 jobs/tick)
- Cron: `learner-readiness-worker-2min` (*/2), `learner-readiness-sla-5min` (*/5)

## UI
- `ExamReadinessDistributionCard` im Heal-Cockpit Diagnostics-Tab (READY/PARTIAL/AT_RISK/CRITICAL/NOT_STARTED + Top-5 Curricula)

## Akzeptanz
- Jeder Mastery-/Sim-Update löst ≤30s neuen Snapshot aus
- AT_RISK/CRITICAL >24h ohne Intervention → automatischer Rescue
- LF-Gap (Lücke <50% in einem LF) verhindert READY auch bei hohem Score
