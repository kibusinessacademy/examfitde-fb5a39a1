---
name: Skill Graph & Dependency Intelligence Bridge v1 (Bridge 12)
description: SSOT für empirische Skill-Abhängigkeiten, Transfer-Effekte und Bottleneck-Erkennung pro Kompetenz
type: feature
---

## Scope
Übergang von „NBA pro Schritt" → „Graph-basiertes Verständnis kritischer Skill-Ketten".

## SSOT Tables
- `skill_dependency_edges` (source/target_competency_id, edge_type [prerequisite|blocks|transfer|co_occurs], confidence 0..1, sample_size, source [empirical|curriculum|manual|hybrid]). UNIQUE per (source, target, edge_type).
- `competency_transfer_patterns` (transfer_score, sample_size, observed_lift_pp, pattern_type [mastery_transfer|recovery_transfer|negative_transfer|none]). UNIQUE per (source, target, pattern_type).
- `kg_competency_nodes` (node_role [hub|bottleneck|bridge|leaf|isolated], in/out_degree, blocks_count, centrality_score). UNIQUE per competency_id.

**Wichtig:** Name `kg_competency_nodes` statt `knowledge_graph_nodes`, weil letzteres bereits als KG-SSOT (Loop A/KG-Rollout) existiert mit anderem Schema (node_type, source_table, source_id, payload).

Alle Tabellen RLS-on, service_role full, admin SELECT via `has_role`.

## Views (service_role only)
- `v_skill_bottlenecks` — Knoten mit node_role IN (bottleneck, hub) ODER blocks_count ≥ 3.
- `v_hidden_dependency_risks` — Edges prerequisite/blocks mit confidence ≥ 0.6 AND sample_size ≥ 10.
- `v_competency_transfer_effects` — Aggregierter Transfer-Score pro source_competency (mastery + recovery).

## RPCs
- `fn_recompute_kg_competency_nodes()` (service_role): idempotenter Recompute aus skill_dependency_edges. Berechnet in_degree/out_degree/blocks_count und mappt node_role:
  - blocks_count ≥ 5 → `bottleneck`
  - in+out ≥ 8 → `hub`
  - in ≥ 2 AND out ≥ 2 → `bridge`
  - in=0 AND out=0 → `isolated`
  - sonst → `leaf`
  Audit `kg_competency_nodes_recomputed` in auto_heal_log.
- `admin_get_skill_graph_summary()` — Cockpit-Summary mit Edge-Counts, Node-Rollen, Transfer-Stats, Top-Bottlenecks (10), Top-Transfer-Quellen (10). has_role gated.
- `admin_recompute_skill_graph()` — Admin-Wrapper für Recompute. has_role gated.

## UI
`SkillGraphIntelligenceCard` im HealCockpit Diagnostics-Tab (nach AutonomousOptimizationCard).
- KPI-Grid: Edges total/HC/Prerequisites/Transfer · Nodes total/Bottlenecks/Hubs/Bridges · Transfer Patterns total/mastery/negative
- Top-5 Bottleneck-Kompetenzen mit blocks/out/score Badges
- Top-5 Transfer-Quellen mit targets/score/n Badges
- „Recompute Graph"-Button

## Audit-Trail
- `kg_competency_nodes_recomputed` (auto_heal_log) bei jedem Recompute mit nodes_upserted + duration_ms.

## Daten-Bootstrap
Edges entstehen empirisch:
- prerequisite/blocks: aus Readiness-Korrelationen (Schwäche A → Schwäche B mit confidence-Heuristik)
- transfer: aus intervention_effectiveness_scores (Intervention auf A erhöht Mastery B)
- co_occurs: aus error_pattern Klassifikation

Bootstrap-Generator (separater Job) folgt — bis dahin können Edges manuell oder via curriculum-Quelle gefüllt werden, Recompute zieht daraus die Node-Metriken.

## Guardrail
Kein autonomes Curriculum-Rewrite. Skill-Graph ist Empfehlungs-Input für NBA/Trainer-Intelligence, nicht für strukturelle Curriculum-Änderung.
