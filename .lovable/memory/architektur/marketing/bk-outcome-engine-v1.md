---
name: BK-Outcome-Engine v1 (BK-Act-3)
description: SSOT workflow_outcomes + deterministische Score-/Confidence-/Recommendation-Engine + UI OutcomeCard
type: feature
---

# BK-Outcome-Engine v1 — Outcomes statt Outputs

**Status:** live (2026-05-26)

## Ziel
BerufsKI verkauft jetzt **Wirkung**, nicht „AI-Antwort". Jeder erfolgreiche Workflow-Run erzeugt **deterministisch** einen Outcome-Score, eine Confidence, Zeitersparnis, Risiko-/Kompetenz-Impact und eine empfohlene Next-Action.

## SSOT-Tabelle `public.workflow_outcomes`
1:1 zu `berufs_ki_workflow_runs` (UNIQUE run_id, ON DELETE CASCADE). Felder: `outcome_type`, `outcome_score` (0..100), `confidence` (0..1), `estimated_time_saved_min`, `risk_reduction_pct`, `competency_impact_pct`, `business_impact_label`, `learner_impact_label`, `recommended_next_action_{key,label,target}`, `computed_factors` (jsonb). RLS: nur Owner + Admin lesen.

## Deterministische Berechnung — `fn_compute_workflow_outcome(run_id)` (SECURITY DEFINER, service_role only)
- **outcome_type** ← category: analyse→`risk_insight`, lernhilfe/fach→`competency_gain`, kommunikation→`communication_efficiency`, dokumentation→`documentation_efficiency`, organisation→`operations_efficiency`
- **score** = `0.6·quality_score + 0.4·coverage_pct` (Fallback 65)
- **confidence**: complete=0.9, partial=0.6, empty=0.2, sonst 0.5 — gemittelt mit coverage_pct
- **time_saved** = `category_minutes · score/100` (Konstanten gespiegelt aus `fn_workflow_time_saved_minutes`)
- **risk_reduction** = `score·0.25`, **competency_impact** = `score·0.3` (nur risk_insight/competency_gain)
- **business_impact_label** nur wenn target_roles ∋ {ausbilder,teamleiter}
- **next_action** deterministisch: risk_insight≥70 → `/app/trainer` Recovery; competency_gain → `/app/trainer` Üben; score<50 → Rerun; sonst Review

## Trigger
`trg_compute_outcome_on_run` AFTER INSERT OR UPDATE OF status — feuert nur bei `status='ok'`. Exception-safe (blockiert Run nie).

## Learner-RPCs (SECURITY DEFINER STABLE, authenticated only)
- `learner_get_workflow_outcome(_run_id uuid)` — owner-scoped Lookup
- `learner_get_outcome_impact_summary(_days int default 30)` — total_outcomes, minutes_saved, avg_score, avg_risk_reduction, avg_competency_impact, by_outcome_type[]

## Audit
`workflow_outcome_computed` registriert in `ops_audit_contract` (required_keys: run_id, workflow_id, outcome_type, outcome_score, confidence; owner_module `berufs-ki/outcome-engine`).

## UI
- `WorkflowOutcomeCard` (`src/components/berufs-ki/WorkflowOutcomeCard.tsx`) wird im `WorkflowRunner` direkt unter dem Ergebnis-Header gerendert. Zeigt: Score · Confidence · Zeitersparnis · Risiko↓ · Kompetenz↑ · Business-Impact · empfohlene Next-Action (mit Link)
- Hook `useWorkflowOutcome(runId)` mit Polling (1.5s) bis Outcome berechnet ist
- `useOutcomeImpactSummary(days)` reserviert für BK-Act-4 BI-Layer

## Backfill
Beim Migrate: bis zu 5000 bestehende `status='ok'` Runs ohne Outcome werden via `fn_compute_workflow_outcome` befüllt (exception-safe).

## Was bewusst NICHT in v1 ist
- AI-generierte Outcome-Beschreibung (bleibt rein deterministisch)
- Team-Aggregation (kommt in BK-Act-4 mit Org-Scope + Heatmaps)
- Recovery-Workflow-Auto-Enqueue (geplant für Act-4)
- A/B-Variants der Next-Action

## Plattform-Wiederverwendbarkeit
SSOT-Pattern (deterministische Outcome-Tabelle hinter generativem Run) wiederverwendbar für ComplianceFit, Voice-Agents, Marketplace-Workflows.
