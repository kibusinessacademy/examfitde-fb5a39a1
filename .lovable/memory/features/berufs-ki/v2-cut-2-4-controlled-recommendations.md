---
name: BerufAgentOS v2 Cut 2.4 Controlled Recommendations Layer
description: HITL Operations Review Center — Detection→Proposal→Review. KEIN Auto-Apply, KEINE Workflow-Mutationen.
type: feature
---

# Cut 2.4 — Controlled Recommendations Layer (LIVE 2026-05-27)

**Scope:** Detection → Proposal → Review Queue. STRIKT HITL.

## Tabellen
- `outcome_fix_proposals` (proposal_key UNIQUE) — Vorschlag inkl. proposal_summary, suggested_fix, expected_outcome, risk_summary, rollback_plan, test_strategy, proposal_evidence (jsonb), expected_kpi_delta_pct_min/max. CHECK-Min-Längen auf summary/fix (24), rollback/test (12).
- `outcome_fix_reviews` — jede Reviewer-Entscheidung mit reason (min 10) + recommended_followup.

## Enums
- `outcome_fix_proposal_type`: 8 types (kpi_drift_fix/workflow_stall_fix/ux_friction_fix/governance_remediation/revenue_leak_fix/seo_recovery/support_signal_response/generic_recommendation)
- `outcome_fix_proposal_source`: 7 sources (workflow/ux/governance/seo/revenue/support_intelligence + manual_curation) — wird später extrem wertvoll
- `outcome_fix_review_state`: draft/in_review/approved/rejected/changes_requested/withdrawn/expired
- `outcome_fix_review_decision`: approved/rejected/changes_requested

## Scoring
- `fn_outcome_fix_priority(severity_score, business_impact, confidence, risk)` IMMUTABLE: 0.30·severity + 0.35·impact + 0.20·confidence + 0.15·(1-risk).

## RPCs (alle SECURITY DEFINER + has_role admin)
- `admin_propose_outcome_fix` (upsert by proposal_key; gesperrt sobald nicht mehr in open-states)
- `admin_submit_fix_review` (HITL-Gate, schreibt review + state-transition + audit)
- `admin_withdraw_fix_proposal`
- `admin_list_fix_proposals` (Filter state/type/source/vertical/intent)
- `admin_get_fix_proposal` (mit Review-Historie)
- `admin_get_fix_proposals_summary` (KPI-Strip)

## Audit-Contracts
- `outcome_fix_proposal_recorded` · `outcome_fix_proposal_review_decided` · `outcome_fix_proposal_withdrawn`

## UI
- `/admin/berufs-ki/fix-queue` (`OutcomeFixQueuePage.tsx`) — Operations Review Center: KPI-Strip, Status-Filter, Proposal-Cards mit Problem/Vorschlag/Wirkung/Risiko/Tests/Rollback + Approve/Changes/Reject/Withdraw Dialog. Klarer Hinweis: "HITL-only — keine Auto-Apply".

## Bridges
- `finding_id → outcome_intelligence_findings` (Cut 2.3 Detector liefert Signale)
- `business_intent_id → business_intents` (Cut 2.1)
- `bundle_id → agent_outcome_bundles`

## Harte Regeln (kein Auto-Mutate)
- ❌ Kein Auto-Apply · ❌ Kein Self-Heal · ❌ Keine Workflow-Mutationen · ❌ Keine Policy-Änderungen · ❌ Keine Security-Mutationen · ❌ Keine Revenue-Logik
- ✅ Detection, Korrelation, Reviewpaket-Erzeugung, Risk-/Test-/Rollback-Bewertung

## Verifikation
- Smoke: `scripts/berufagentos-cut2-4-smoke.mjs`
- Migration: `supabase/migrations/*_controlled_recommendations*.sql`

## Nächster Schritt (NICHT in 2.4)
Cut 2.5+ kann Persona-Sim + Mission Control aufsetzen. Controlled-Autonomy (Apply-Phase) ERST nach 2.5/2.6 und nur mit zusätzlichem Apply-Ledger.
