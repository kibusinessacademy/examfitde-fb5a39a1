---
name: E3e.0 Bridge Governance Schema v1
description: SSOT-Scaffold für Semantic Bridge Layer zwischen Subgraph A (Blog/Contextual) und B (Pillar/Authority). 2 Tabellen + 5 Bridge-Typen + Governance-Defaults, keine Mutationen
type: feature
---

# E3e.0 · Semantic Bridge Layer · Governance Schema

## Kontext (aus E3d.2b Recon)
Zwei **disjunkte** Subgraphen:
- **Subgraph A** (Contextual Blog): 118 Nodes / 3744 Edges — Knowledge Graph
- **Subgraph B** (Pillar/Authority): ~589 Nodes / 824 Edges — Commercial Authority Graph

**Strategie:** Option A · Controlled Bridging (wenige, hochwertige Brücken — kein Vollmesh).

## SSOT-Tabellen
- `seo_bridge_type_registry` (PK link_type) — welche Bridge-Typen existieren, source_layer→target_layer, is_active.
- `seo_bridge_governance` (PK link_type, FK→registry) — pro-Typ Constraints:
  - `max_outbound_per_source` (1–20)
  - `max_inbound_per_target` (1–200)
  - `min_semantic_similarity` (0–1, default 0.50)
  - `max_per_apply_run` (1–200, default 25)
  - `requires_admin_approval` (default true)
  - `entropy_dilution_max` (default 0.05)
  - `hop_depth_max_increase` (0–6, default 1)

## 5 Bridge-Typen (Seed)
| link_type | source_layer | target_layer | max_out | min_sim | cap/run | purpose |
|---|---|---|---|---|---|---|
| blog_to_pillar | contextual_blog | pillar_authority | 3 | 0.55 | 25 | semantic → authority |
| pillar_to_cornerstone_blog | pillar_authority | contextual_blog | 2 | 0.60 | 25 | authority → semantic |
| cluster_to_blog | cluster_intent | contextual_blog | 4 | 0.50 | 50 | curriculum → discovery |
| blog_to_exam_package | contextual_blog | exam_package | 2 | 0.65 | 15 | discovery → conversion (tightest) |
| certification_to_learning_content | certification | learning_content | 3 | 0.55 | 30 | authority → curriculum |

## RLS / Zugriff
- Service-Role: ALL.
- Admins: SELECT (über has_role).
- Sonst: kein Zugriff.

## Audit-Contracts (registriert)
- `seo_bridge_governance_initialized` (phase, bridge_types_seeded, governance_rows_seeded)
- `seo_bridge_governance_updated` (link_type, field, old_value, new_value, actor_id)
- `seo_bridge_type_toggled` (link_type, is_active, actor_id)

Initial-Audit emittiert: `d5223723-8a8a-49be-8119-f82796dd40e8` (2026-05-17).

## Out of scope (folgt)
- **E3e.1**: Bridge-Candidate-Recon Views + RPCs (read-only, liest governance als Filter).
- **E3e.2**: admin_apply_bridge_edges RPC mit dry-run (analog Phase 2F).
- **E3e.3**: UI BridgeRecon-Card + Apply-Dialog.
- CHECK-Constraint auf `seo_internal_link_suggestions.link_type` (erst nach E3e.2 stabil).

## Rollback
```sql
DROP TABLE public.seo_bridge_governance;
DROP TABLE public.seo_bridge_type_registry;
DELETE FROM public.ops_audit_contract WHERE owner_module='seo_bridge_layer';
```
