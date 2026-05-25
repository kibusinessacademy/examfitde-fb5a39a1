---
name: E3e.5 Content-Enrichment-Welle Top-30 v1
description: SSOT-Snapshot der Top-30 Cornerstone-Kandidaten mit 8-Dim Gap-Analyse; Pillar-Flip OFF bis ≥0.60
type: feature
---

# E3e.5 — Content-Enrichment-Welle Top-30

Read-only Diagnose-Schicht über `v_cornerstone_blog_score`. Identifiziert die 30 Blogs, die der Cornerstone-Reife (`score ≥ 0.60`) am nächsten sind, und persistiert pro Snapshot welche der 8 Dimensionen unterbesetzt sind (`< 0.60`): depth, faq, quality, hero, anchor, winner, views, perf.

## SSOT
- **Tabelle** `seo_cornerstone_enrichment_targets` (snapshot_id + rank + blog_article_id + gap_dimensions[] + 8 s_* Scores). RLS: admin-only read.
- **Snapshot-RPC** `admin_seo_cornerstone_snapshot_top_targets(_n int default 30)` — has_role gated, schreibt 1 Snapshot, emittiert `cornerstone_enrichment_targets_snapshotted` (required_keys: snapshot_id, count, top_score, avg_gaps).
- **Summary-RPC** `admin_get_cornerstone_enrichment_summary` — letzter Snapshot mit KPIs + gap_histogram + targets[].

## Baseline 2026-05-25
- 30 Targets snapshotted, **top_score = 0.4011**, **avg_gaps = 5.6 / 8**.
- Häufigste Gap-Dimensionen: hero (30), anchor (30), winner ≈ 28, views ≈ 28, perf ≈ 28.
- Die meisten Top-30 sind "Rahmenlehrplan"-Pillar-Pages (s_depth + s_faq + s_quality bereits hoch, aber kein Hero-Asset, keine internen Anchor-Sektionen, kein Winner-Tag, keine Views/Perf-Daten).

## Human-Gate
Pillar-Flip `pillar_to_cornerstone_blog` bleibt **OFF** bis ≥1 Blog die 0.60-Schwelle reißt. Kein Auto-Promote.

## UI
`SeoCornerstoneEnrichmentCard` in `/admin/heal` (zwischen `SeoBridgeOutcomeCard` und `SeoBridgePromotionCard`). Snapshot-Button für manuellen Refresh.

## Next
Concrete Enrichment-Welle (Hero-Asset-Generation + Anchor-Section-Generation für Top-30) erfordert eigene Job-Pipeline — separate Entscheidung, nicht in diesem Cut.
