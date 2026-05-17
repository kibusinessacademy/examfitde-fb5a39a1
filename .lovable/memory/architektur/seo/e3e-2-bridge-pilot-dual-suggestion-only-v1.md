---
name: E3e.2 Bridge-Pilot (Dual, Suggestion-Only) v1
description: Kontrollierter Dual-Pilot Cross-Graph (blog_to_pillar + blog_to_exam_package), Suggestion-Only ohne Materialisierung, pillar_to_cornerstone_blog deaktiviert bis perf-basiertes Cornerstone-Scoring
type: feature
---

# E3e.2 Bridge-Pilot — Suggestion-Only

Kontrollierte Cross-Graph-Vorschlagsschicht zwischen Subgraph A (Blog/Contextual)
und Subgraph B (Pillar/Authority/Exam-Package). KEINE Materialisierung — nur
Kandidaten in dedizierter Pilot-Tabelle für E3e.3 selective activation.

## Aktive Pilot-Konfiguration

| bridge_type                | pilot_active | pilot_cap | max_out/src | max_in/tgt | min_sim |
|----------------------------|--------------|-----------|-------------|------------|---------|
| blog_to_pillar             | ✅           | 60        | 2           | 5          | 0.55    |
| blog_to_exam_package       | ✅           | 40        | 2           | 5          | 0.65    |
| pillar_to_cornerstone_blog | ❌           | 0         | (no run)    | (no run)   | 0.60    |

`pillar_to_cornerstone_blog` ist **bewusst deaktiviert** bis perf-basiertes
Cornerstone-Scoring (CTR / dwell / assisted_conversion / is_winner) den
schwachen word_count≥2000-Proxy ersetzt (avg_sim 0.417 → semantic dilution risk).

## Komponenten

- **Tabellen**
  - `seo_bridge_pilot_runs` — Lauf-Metadaten + Governance-Snapshot + correlation_id
  - `seo_bridge_pilot_candidates` — selektierte Kandidaten + explainability jsonb (Gates + Ranks)
- **Registry-Erweiterung** `seo_bridge_type_registry`: `pilot_active`, `pilot_cap`, `pilot_started_at`, `pilot_notes`
- **RPCs (service_role/admin)**
  - `admin_seo_bridge_pilot_generate(p_link_type, p_dry_run default true)` — Default Dry-Run; bei live insert in `_runs` + `_candidates`; respektiert Caps + Bronze-Lock (für exam_package targets)
  - `admin_get_bridge_pilot_snapshot()` — letzte Lauf-Stats pro Bridge-Typ
  - `admin_get_bridge_pilot_explainability_sample(p_link_type, p_limit)` — Top-Kandidaten des letzten Laufs
- **Audit-Contracts** (registriert in ops_audit_contract):
  - `seo_bridge_pilot_generate_run`
  - `seo_bridge_pilot_governance_updated`
  - `seo_bridge_pilot_explainability_sampled`

## Governance-Hardgates im Generator

- READY-only aus `v_seo_bridge_candidates_v1`
- `source_published=true AND target_published=true`
- `duplicate_existing=false`
- `blog_to_exam_package`: target NOT bronze-locked (`fn_is_bronze_locked`)
- Per-Source-Cap → Per-Target-Cap → Global-Cap (deterministische row_number-Reihenfolge)

## NICHT enthalten (Scope-Disziplin)

- Keine Inserts in `seo_internal_link_suggestions`
- Keine `status='active'`-Flips
- Kein Auto-Cron — Pilot-Läufe nur manuell via RPC

## Nächste Cuts

- **E3e.3** selective activation: promote ausgewählte Pilot-Candidates → suggested/active
- **E3e.4** empirical outcome measurement (CTR / crawl-depth / ranking-lift)
- **E3e.5** adaptive bridge weighting + perf-basiertes Cornerstone-Scoring → reaktiviert `pillar_to_cornerstone_blog`
