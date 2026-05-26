---
name: BerufOS Graph Activation Layer v1
description: 5 deterministische RPCs (Skill-Actions, Tutor-Context, Workflow-Recos, Manager-Risk, ExamFit-Bridge) machen den berufs_ki_graph_* SSOT produktiv. Keine Parallel-Edges, alle Reads scope-gated und auditiert.
type: feature
---

# BerufOS Graph Activation Layer v1

**Cut nach Foundation:** Der Graph trägt jetzt Entscheidungen, nicht nur Admin-Cockpits.

## RPCs (alle defensiv mit reason-codes statt Exceptions)

- `learner_get_next_best_skill_actions(p_limit)` — weak competencies (`learner_competency_state.mastery_score<0.65`) → graph edges `trains|recovers|assesses|strengthens` → `lesson|recovery_action|workflow|blueprint`.
- `tutor_get_graph_context(p_competency_id, p_lesson_id)` — Chain + Evidenz. Reason `NO_GRAPH_EVIDENCE` blockt Antwort.
- `learner_get_graph_workflow_recommendations(p_limit)` — weak comp → `trains|strengthens|produces` → workflow nodes.
- `manager_get_graph_risk_explanations(p_window_days)` — scope via `fn_org_visible_user_ids` (fallback self), Top-20 at-risk comps + suggested actions.
- `learner_get_examfit_graph_bridge(p_certification_id)` — certification node → competencies → blueprints, gewichtet nach learner gap.

## Reasons (SSOT)
`OK | NO_LEARNER_STATE | GRAPH_NOT_POPULATED | NO_GRAPH_LINKED_WEAK_COMPETENCIES | NO_GRAPH_LINKED_WORKFLOWS | NO_GRAPH_NODE_FOR_SCOPE | NO_GRAPH_EVIDENCE | NO_CERTIFICATION_NODE | NO_GRAPH_LINKED_COMPETENCIES | NO_AT_RISK_COMPETENCIES_IN_WINDOW`

## Audit-Contracts (`ops_audit_contract`, `owner_module='berufos_graph_activation'`)
- `graph_activation_learner_skill_query`
- `graph_activation_tutor_context_query`
- `graph_activation_workflow_reco_query`
- `graph_activation_manager_risk_explain`
- `graph_activation_examfit_bridge_query`

Pflicht-Keys: `user_id`, `returned`, `reason` (+ scope-spezifisch).

## Frontend SSOT
- `src/lib/berufs-ki/graphActivation.ts` (typed envelope `{ reason, items, returned }`)
- `src/hooks/useGraphActivation.ts` (5 React-Query hooks, 60s staleTime)
- `src/components/berufs-ki/GraphActivationCards.tsx` (Design-System v2 Tokens, kein hardcoded color)
- `/berufs-ki/graph-activation` — Learner-Entry-Page (skill + workflow + manager-risk)

## Anti-Goals (eingehalten)
- Keine neuen Tabellen, keine neuen Edge-Types.
- Keine AI-Calls im Kern-Entscheidungspfad (nur deterministisches SQL).
- Manager-Funktion respektiert org-Scope hart (`fn_org_visible_user_ids`).
- Tutor blockt bei fehlender Evidenz (`NO_GRAPH_EVIDENCE`), generiert nichts.

## Helper
- `fn_bki_node_for_competency(competency_id) → graph node id` (re-used von allen 5 RPCs).

## Baseline 2026-05-26
- 0 active graph edges (Foundation rebuild noch nicht produktiv ausgeführt) → alle Lerner-RPCs liefern reason `GRAPH_NOT_POPULATED`. Aktivierung erfolgt automatisch sobald `admin_rebuild_berufos_graph(_,_dry_run:=false)` läuft.

## Next Cuts (nicht in v1)
- A2: Auto-Trigger Activation nach Lesson-Completion (writes back to graph evidence).
- A3: Tutor Edge-Function bindet `tutor_get_graph_context` strikt als Pre-Check ein (RAG-Gate).
- A4: ExamFit Drill-Builder konsumiert `learner_get_examfit_graph_bridge` für adaptive question selection.
