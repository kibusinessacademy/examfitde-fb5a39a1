---
name: BerufAgentOS Cut 1.1 — Premium Depth Layer
description: Risk-Tier, KPI normalization, decision history, demo bundles, executive brief export, agent×vertical matrix
type: feature
---
# Cut 1.1 — Premium Depth Layer

Erweitert v1-Foundation um Premium-Tiefe — keine neue Breite.

## Schema
- `agent_outcome_bundles.is_demo BOOLEAN DEFAULT false` + `risk_tier TEXT CHECK (LOW|MEDIUM|HIGH)`
- `fn_compute_bundle_risk_tier(completeness, confidence, risks, vertical)` SECURITY DEFINER
- `trg_set_bundle_risk_tier` BEFORE INSERT/UPDATE OF completeness_pct, confidence, risk_register, vertical_key

## Views (service_role only)
- `v_agent_vertical_coverage` — agent_slug × vertical_key (bundle_count, avg_completeness, approved_count, high_risk_count, last_run_at)
- `v_bundle_kpi_impact_normalized` — unnest kpi_impact JSONB array → metric/baseline/target/delta/delta_pct/confidence/horizon
- `v_bundle_decision_history` — outcome_bundle_* aus auto_heal_log mit decision/actor_id/reason

## RPCs (admin-gated)
- `admin_get_agent_vertical_matrix()` — agents + verticals + cells für Heatmap
- `admin_get_bundle_kpi_impact(bundle_id)` — metrics + benchmarks aus vertical_dna.kpis
- `admin_get_bundle_decision_history(bundle_id)` — Timeline chronologisch

## Audit-Contracts
- `outcome_bundle_exported` (bundle_id, format, exported_by, byte_size)
- `demo_bundle_seeded` (bundle_id, vertical_key)

## Edge Function
- `berufs-agent-outcome-export` — Markdown Executive Brief (Cover, Business Case, KPI-Tabelle, Roadmap, Risiken, Rollback, Audit-Trail). Admin-gated. Loggt outcome_bundle_exported.

## UI
- `src/components/berufs-ki/BundleRiskBadge.tsx`
- `src/components/berufs-ki/BundleDecisionTimeline.tsx`
- `src/components/berufs-ki/KpiImpactPanel.tsx`
- `src/components/berufs-ki/AgentVerticalMatrix.tsx`

## Seed
10 Demo Outcome Bundles (1 pro Vertical: banking, healthcare, public_admin, education, hr, consulting, crafts, real_estate, support, funding). Alle status='approved', is_demo=true, completeness 100%, risk_tier MEDIUM. Realistische KPIs + Business Cases mit € 340k – € 3.2M Wert.

## Verworfen für Cut 1.2
- PDF/PPTX-Export
- Multi-Bundle-Vergleich
- Eigene `/admin/berufs-ki/vertical-dna`-Seite (DNA bleibt im Detail-Page-Tab)
- Wiring der neuen UI-Komponenten in OutcomeBundleDetailPage (folgt in 1.1.b — TODO)

## Migration
`20260527073527_*` (kombiniert M1-M5).
