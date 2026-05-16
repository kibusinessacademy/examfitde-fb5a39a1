---
name: Adaptive Learning Path Orchestration Bridge v1 (Bridge 13)
description: SSOT-bounded Pfadsteuerung. Recommender entscheidet was als Nächstes — aus existing Lessons/Blueprints/MiniChecks. Kein Curriculum-Rewrite, kein Content-Erfinden.
type: feature
---

## Scope
Übergang von „NBA pro Schritt" → „explainable Multi-Step Lernpfad" innerhalb SSOT-Grenzen.

## SSOT Tables
- `adaptive_learning_paths` — pro user×curriculum (UNIQUE active via partial idx), 6h TTL, steps[] jsonb, context (readiness/risk/days_to_exam snapshot). Status: active|completed|superseded|abandoned.
- `learner_path_decisions` — append-only Audit jeder Step-Entscheidung (recommended/served/accepted/skipped/completed/blocked_by_guardrail). step_index + rationale + constraints_evaluated.
- `path_intervention_constraints` — Hard-Allowlist + Forbid-Liste. Seed 8 Constraints inkl. `no_content_generation`, `no_curriculum_mutation`, `lessons_only_from_ssot`, `blueprints_only_approved`, `dependency_edges_validated`.

Alle Tabellen RLS-on, service_role full. Learner SELECT own. Admin SELECT all via `has_role`.

## Views (service_role only)
- `v_adaptive_path_candidates` — aktive Paths mit TTL>now.
- `v_path_bottleneck_recovery` — Paths mit rationale_code='bottleneck_recovery', join `kg_competency_nodes` (Bridge 12).
- `v_path_effectiveness` — served vs completed/skipped/blocked pro step_type (30d, completion_rate_pct).

## RPC
- `fn_compute_adaptive_path(user, curriculum)` SECURITY DEFINER (service_role): supersedes alte active Path, baut neue steps:
  1. Bottleneck-Recovery (wenn `kg_competency_nodes.node_role='bottleneck'` & blocks_count≥3) → priority 90, rationale `bottleneck_recovery`, constraint `dependency_edges_validated`.
  2. Weakness-Drill: top 2 weak/struggling Competencies × published lessons → priority 70, constraint `lessons_only_from_ssot`.
  3. Exam-Simulation falls readiness_band IN (PARTIAL,READY) → priority 60, constraint `blueprints_only_approved`.
  Jeder Schritt enthält `constraints_passed[]`. Audit `adaptive_path_computed` in auto_heal_log.
- `admin_get_adaptive_path_health()` `has_role` gated: paths-Counts + effectiveness + constraints + 20 recent decisions.

## UI
`AdaptivePathOrchestrationCard` im HealCockpit Diagnostics-Tab (nach SkillGraphIntelligenceCard).
- KPI: Active/Completed/Superseded/Constraints
- Effectiveness pro step_type (served/done/skip/block + completion%)
- Recent Decisions Liste

## Guardrails (Hard)
- Kein autonomes Content-Generation (`forbid_action`)
- Kein Curriculum-Reorder/Insert/Delete (`forbid_action`)
- Lessons MUSS status=published
- Blueprints MUSS status=approved
- MiniChecks MUSS approved exam_questions
- Recovery-Sequenzen MÜSSEN über validierte `skill_dependency_edges` referenzieren

## Strategischer Effekt
ExamFit entscheidet jetzt explainable Multi-Step („was als Nächstes optimal ist") statt nur einzelne NBAs — auf Basis von Skill-Graph (B12), Effectiveness (B6/7), Risk (B4), Tutor-Modus (B8). Pfade sind 6h-TTL recomputable, vollständig audited, und niemals mutieren sie das Curriculum.

## Nächste Stufen (offen)
- Worker `adaptive-path-worker` der `fn_compute_adaptive_path` bei readiness/risk-Änderung triggert.
- Lerner-UI „Dein Pfad heute" liest `v_adaptive_path_candidates`.
- Soft-Filter Caps (`max_lessons_per_session=3`, `max_simulations_per_day=2`) im Recommender enforce.
- Path-Effectiveness → Auto-Tuning der Step-Priority-Heuristik (Bridge 11 Loop).
