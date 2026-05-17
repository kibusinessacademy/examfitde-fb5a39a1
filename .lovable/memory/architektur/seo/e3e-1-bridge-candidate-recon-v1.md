---
name: E3e.1 Bridge Candidate Recon v1
description: Read-only Recon der Bridge-Kandidaten zwischen Subgraph A (Blog) und B (Pillar/Package). Unified View + Summary-View + 2 RPCs + 1 Audit-Contract. Keine Mutationen
type: feature
---

# E3e.1 · Bridge-Candidate-Recon (read-only)

## Was läuft
- `v_seo_bridge_candidates_v1` — unified View (eine Zeile pro Quelle×Ziel×link_type) mit `similarity_score`, `source_rank`, `duplicate_existing` und `decision` ∈ {READY, BLOCKED_DUPLICATE_EXISTING, BLOCKED_BELOW_MIN_SIMILARITY, BLOCKED_SOURCE_CAP, BLOCKED_UNPUBLISHED, NO_SOURCE_LAYER_DATA, NO_TARGET_LAYER_DATA}.
- `v_seo_bridge_candidates_summary_v1` — pro link_type alle 9 KPIs (candidate/eligible/blocked/duplicate/below_sim/cap/unpublished/no_source/no_target + avg/min/max similarity + distinct sources/targets).
- RPCs `admin_get_bridge_candidates_summary()` + `admin_get_bridge_candidates_top(p_link_type, p_limit, p_decision)` mit has_role-Gate.
- Audit-Contract `bridge_candidate_recon_detected` registriert.

## Resolution-Pfade (deterministisch)
- **blog_to_pillar**: `blog_articles.source_curriculum_id → course_packages.certification_id → certification_catalog.linked_certification_id → certification_seo_pages.certification_catalog_id`. Score 1.00 wenn `source_package_id` direkt, sonst 0.85.
- **pillar_to_cornerstone_blog**: gleicher Pfad reverse, Score = `LEAST(1.0, GREATEST(0.40, word_count/2000))` als Cornerstone-Proxy.
- **blog_to_exam_package**: `source_package_id`=1.00, sonst Curriculum-Match=0.75. URL `/shop/<product_slug>`.
- **cluster_to_blog**: SKELETON — `seo_documents.landing` aktuell 0 published.
- **certification_to_learning_content**: SKELETON — kein Learning-Content-Route etabliert.

## Baseline 2026-05-17
| link_type | candidates | eligible | blocked | avg_sim | distinct_targets |
|---|---|---|---|---|---|
| blog_to_pillar | 143 | **143** | 0 | 0.988 | 123 |
| blog_to_exam_package | 186 | **186** | 0 | 0.950 | 138 |
| pillar_to_cornerstone_blog | 143 | 2 | **141** (below_sim) | 0.417 | 2 |
| cluster_to_blog | 0 | 0 | 0 | – | – |
| certification_to_learning_content | 0 | 0 | 0 | – | – |

**Kritisch:** 0 duplicate_existing über alle Typen → Bridge-Layer ist Greenfield, kein Kollisions-Risiko gegen die 4568 bestehenden Edges.

## Governance-Findings für E3e.2 Pilot
- **blog_to_pillar** und **blog_to_exam_package** sind perfekte Pilot-Kandidaten (143 + 186 READY, 0 blocked, avg_sim ≥0.95). Caps (3/2) reichen, weil die meisten Sources nur 1–2 Targets haben.
- **pillar_to_cornerstone_blog**: min_semantic_similarity=0.60 zu strikt für word_count-Proxy (nur 2/143 eligible). Vor E3e.2 entweder Gate auf 0.50 senken ODER Cornerstone-Signal wechseln (z.B. performance_score / is_winner).
- **cluster_to_blog** + **certification_to_learning_content** bleiben Skeleton bis eigene Quellen aufgebaut sind.

## Out of scope
- E3e.2 admin_apply_bridge_edges (dry-run+live, analog Phase 2F).
- E3e.3 BridgeReconCard UI.
- Echte semantische Ähnlichkeit (embedding-basiert) — aktuell rein deterministische Joins.
- Cornerstone-Signal-Tuning (siehe Pilot-Frage oben).

## Rollback
```sql
DROP FUNCTION public.admin_get_bridge_candidates_top(text,int,text);
DROP FUNCTION public.admin_get_bridge_candidates_summary();
DROP VIEW public.v_seo_bridge_candidates_summary_v1;
DROP VIEW public.v_seo_bridge_candidates_v1;
DELETE FROM ops_audit_contract WHERE action_type='bridge_candidate_recon_detected';
```
