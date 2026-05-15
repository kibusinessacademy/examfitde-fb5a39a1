---
name: Internal Link Graph v2 — Strikte Typ-Trennung + cluster_to_cluster v1
description: Direktive für SEO Internal-Link-Graph v2. Drei strikt getrennte Link-Typen (cluster_to_pillar, pillar_to_cluster, cluster_to_cluster) — nie vermischen, da Weights/Render/Crawl-Prio/LLM-Signale später pro Typ divergieren. cluster_to_cluster v1: 2–4 semantisch stärkste Nachbarn, deterministisch, bidirektional, kein Vollmesh (vermeidet Link-Noise + schwache Semantic Cohesion). Pair-Map curated als versionierte Tabelle seo_intent_pair_map(intent_a,intent_b,weight,version) — damit Weights extern steuerbar ohne RPC-Touch. Höchstes Conversion-Gewicht: pruefungsfragen↔pruefungssimulation. Architektur-Linie ab Pillar-v1: Knowledge Graph + Intent Graph (gleicher Edge-Graph dient AI Tutor RAG + LLM-Visibility).
type: constraint
---

## Link-Typen (strikt getrennt)

| Link-Typ              | Richtung           | Quelle                                  |
|-----------------------|--------------------|------------------------------------------|
| cluster_to_pillar     | Spoke → Pillar     | `admin_seo_link_spokes_to_pillar` (live) |
| pillar_to_cluster     | Pillar → Spoke     | NEU — separater Typ, kein Reuse          |
| cluster_to_cluster    | Spoke ↔ Spoke      | `admin_seo_link_spoke_pairs` (geplant)   |

Niemals einen Typ mehrfach verwenden, niemals via filter im Frontend "kompensieren". Render/Crawl-Prio/Weight muss pro Typ steuerbar bleiben.

## cluster_to_cluster v1

- **Nicht vollvermaschen.** Nur 2–4 stärkste Nachbarn pro Spoke.
- **Bidirektional**: jedes Paar als 2 Rows.
- **Deterministisch**: curated Pair-Map, kein NLP/Embedding in v1.
- **Idempotent**: Unique-Key `(source_url, target_url, link_type)` (bestehender Index).
- **Audit**: `auto_heal_log.action_type = 'seo_spoke_pair_linker_run'` mit `pairs_upserted` / `pairs_skipped`.

## Pair-Map v1 (high-confidence, curated)

| A                    | B                      | Weight | Begründung                                    |
|----------------------|------------------------|--------|------------------------------------------------|
| pruefungsfragen      | pruefungssimulation    | 1.00   | nahezu identische Suchintention, Conversion-Stärkste |
| lernzettel           | pruefungssimulation    | 0.85   | Lern → Test Loop                               |
| wie_schwer           | erfahrung              | 0.80   | Erwartungsmanagement-Cluster                   |
| typische_fehler      | durchfallquote         | 0.80   | Risiko-Cluster                                 |
| lernplan             | lernzettel             | 0.75   | Plan → Material Loop                           |

Pair-Map als Tabelle `seo_intent_pair_map(intent_a, intent_b, weight, version, is_active)` — damit Pflege ohne RPC-Migration möglich.

## Architektur-Linie ab Pillar-v1

Der Edge-Graph (Pillar + Spoke + cluster_to_cluster) ist NICHT nur SEO-Konstrukt, sondern Foundation für:
- AI Tutor Context Retrieval (gleiche Nachbarschaft → besserer RAG-Kontext)
- LLM Visibility (semantische Nachbarschaft als Crawl-Hinweis)
- adaptive Recommendations (Spoke-Empfehlungen basierend auf Edge-Weight)
- semantische Navigation (Spoke→Spoke ohne Pillar-Umweg)
- Query Understanding (Intent-Pair-Verwandtschaft)

## Out of Scope v1
- NLP/Embedding-basiertes Pair-Discovery (v2)
- Cross-Curriculum-Cluster (v2)
- Auto-Decay von ungenutzten Edges (v2)
- Vollmesh oder >4 Nachbarn pro Spoke (verboten)
