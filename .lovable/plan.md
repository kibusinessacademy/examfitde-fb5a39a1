# BerufAgentOS v1.1 — Premium Depth Layer

Ziel: Aus „funktioniert" wird **verkaufbarer Premium-Wow**. Keine neue Breite — nur die 6 Tiefenhebel auf der bestehenden Cut-1-Infrastruktur (`vertical_dna`, `agent_outcome_bundles`, `agent_outcome_artifacts`, `berufs_ki_agents`, `runtime_safe_actions`).

---

## Sub-Cut 1.1.A — Berufs-DNA Viewer vertiefen

**Bestehend:** Vertical-DNA-Tab in `OutcomeBundleDetailPage` zeigt rohes JSON.
**Neu:** Strukturierter Viewer mit 6 Sektionen (Roles, KPIs, Risks, SOPs, Regulatory, Stakeholder-Map) + Vergleich „DNA-Slice → Bundle-Output" (welche DNA-Felder wurden tatsächlich genutzt).

- Neue Komponente `src/components/berufs-ki/VerticalDnaViewer.tsx` — Tabs + Token-Highlight
- Neue Page `/admin/berufs-ki/vertical-dna` + `/admin/berufs-ki/vertical-dna/:industryKey` (Detail)
- RPC `admin_get_vertical_dna_full(industry_key)` (existiert bereits als `admin_get_vertical_dna`, ggf. erweitern um `linked_bundles_count`)

## Sub-Cut 1.1.B — Branchen-DNA Mapping sichtbar machen

**Bestehend:** `berufs_ki_agents.vertical_keys` bridge existiert.
**Neu:** Visual Matrix „Agent × Branche × Outcome-Coverage" — zeigt welche Agenten welche Verticals abdecken und wie viele erfolgreiche Bundles je Kombination existieren.

- View `v_agent_vertical_coverage` (agent_key, vertical_key, bundle_count, avg_completeness, last_run_at)
- RPC `admin_get_agent_vertical_matrix()` (SECURITY DEFINER, has_role-gate)
- Komponente `AgentVerticalMatrix.tsx` (Heatmap) im OutcomeControlCenter

## Sub-Cut 1.1.C — KPI Impact Panel realer/vergleichbarer machen

**Bestehend:** `kpi_impact` JSON-Section.
**Neu:** Strukturierte KPI-Tabelle mit Baseline → Target → Delta + Branchen-Benchmark (aus `vertical_dna.industry_kpis`) + Confidence-Indikator.

- Schema-Erweiterung: trigger `fn_compute_kpi_delta` auf `agent_outcome_bundles` — extrahiert `kpi_impact.metrics[]` → schreibt in neue View `v_bundle_kpi_impact_normalized`
- RPC `admin_get_bundle_kpi_impact(bundle_id)`
- Komponente `KpiImpactPanel.tsx` mit Recharts-Bars + Benchmark-Linie

## Sub-Cut 1.1.D — Outcome Bundle als „Executive Brief" exportierbar

**Bestehend:** Section-Download als JSON.
**Neu:** Ein-Klick „Executive Brief"-Export als Markdown (v1) — strukturiert: Cover (Vertical, Goal, Completeness, KPI-Top3) → Business Case → KPI Impact → Roadmap → Risks → Next Steps → Audit-Trail.

- Edge Function `berufs-agent-outcome-export` — Input: `bundle_id`, Output: Markdown-Blob
- Audit-Contract `outcome_bundle_exported` (bundle_id, format, exported_by, byte_size)
- UI-Button „Executive Brief exportieren" in BundleDetail-Header

## Sub-Cut 1.1.E — Review Queue mit Risiko-Badges + Freigabehistorie

**Bestehend:** `runtime_safe_actions` Review-Queue.
**Neu:**
- Risiko-Score je Bundle (LOW/MEDIUM/HIGH) abgeleitet aus: completeness_pct, vertical_dna.risk_level, agent confidence avg, regulatory_flags Anzahl
- Freigabehistorie-Timeline pro Bundle (alle Decisions chronologisch mit Reason, Actor, Timestamp)

- Generated Column `agent_outcome_bundles.risk_tier` (computed via `fn_compute_bundle_risk_tier`)
- View `v_bundle_decision_history` über `auto_heal_log` action_type=outcome_bundle_decision
- Komponente `BundleRiskBadge.tsx` + `BundleDecisionTimeline.tsx` in BundleDetail

## Sub-Cut 1.1.F — Demo-Cases je Branche seedbar

**Bestehend:** 10 Vertical-DNA-Seeds.
**Neu:** Pro Vertical genau 1 vorgefertigtes Demo-Bundle (status=approved, completeness=92%, alle 11 Sections gefüllt, risk_tier=LOW) als Sales-Demo-Material.

- Migration `seed_demo_bundles_v1` — 10 fertige Bundles mit `is_demo=true` Flag
- Spalte `agent_outcome_bundles.is_demo BOOLEAN DEFAULT false`
- Filter-Toggle „Demo Cases anzeigen" in `OutcomeControlCenterPage`
- Audit `demo_bundle_seeded` Contract

---

## Reihenfolge & Migrations-Disziplin

1. **DB-Migration** (5 Concerns, separat):
   - M1: `agent_outcome_bundles.is_demo` + `risk_tier` + `fn_compute_bundle_risk_tier` + Trigger
   - M2: `v_agent_vertical_coverage` + `admin_get_agent_vertical_matrix` RPC
   - M3: `v_bundle_kpi_impact_normalized` + `admin_get_bundle_kpi_impact` RPC
   - M4: `v_bundle_decision_history` View
   - M5: Audit-Contracts: `outcome_bundle_exported`, `demo_bundle_seeded`
2. **Demo-Bundles Seed** (`supabase--insert`, 10 Rows)
3. **Edge Function** `berufs-agent-outcome-export` (deploy via tool)
4. **UI-Komponenten** (6 neue + 2 Page-Edits)
5. **Smoke-Tests** `scripts/berufagentos-v1-1-smoke.mjs`
6. **Memory-Freeze** Update

## Explizit NICHT in 1.1

- PDF/PPTX Export (1.2)
- Multi-Bundle-Vergleich (1.2)
- Agent-Performance-Forensics (1.3)
- Marketplace-Listings (Market-Activation)
- Neue Verticals (bleibt bei 10)

## Architekturkonformität

- SSOT-First: erweitert bestehende Tabellen, keine Parallel-Systeme
- Bridge-Don't-Fork: nutzt `auto_heal_log` + `runtime_safe_actions` weiter
- Auditable Mutations: alle 6 Cuts loggen via `fn_emit_audit`
- Security Inherits: alle neuen RPCs SECURITY DEFINER + `has_role(auth.uid(),'admin')`
- No Hidden State: alle neuen Spalten/Views in Cockpit sichtbar
