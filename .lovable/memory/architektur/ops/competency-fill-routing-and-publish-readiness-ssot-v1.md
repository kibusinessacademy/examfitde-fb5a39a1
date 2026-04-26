---
name: Coverage-Gap → Competency-Fill Routing + Publish-Readiness SSOT
description: fn_enqueue_competency_fill_for_gap_packages routet gap_blocking_publish auf package_repair_exam_pool_competency_coverage; Cockpit nutzt v_admin_publish_readiness statt eigener Heuristik
type: feature
---

## Problem
1. **Coverage-Gap-Lane war tot**: 415 Pakete in `v_package_coverage_gap`, aber `package_repair_exam_pool_competency_coverage`-Jobs wurden nirgends automatisch enqueued (nur 18× manuell in 24h gesehen). Diagnose ohne Heilung.
2. **Cockpit-Drift „4 Pakete bereit"**: `SmartNextBestAction` und `admin-growth-seo-tower` nutzten eigene Heuristiken (`council_approved && !is_published && !blocked_reason` bzw. `status='done'`/`status='quality_gate_failed'` — beides nicht-existente Werte) statt der kanonischen DB-Sicht.

## Lösung

### Routing-Funktion (DB)
`public.fn_enqueue_competency_fill_for_gap_packages(max_per_run, cooldown_minutes)`:
- Iteriert `v_package_coverage_gap WHERE gap_severity='gap_blocking_publish'`
- Hebt `blocked content_gap`/`quality_no_progress_3x` Pakete zurück auf `building` (P0a-Guard erfordert das)
- Enqueued `package_repair_exam_pool_competency_coverage` mit `package_id` + `curriculum_id` (SSOT-Guard-Pflichtfelder)
- 30-min-Cooldown pro Paket
- Audit in `system_heal_log` (`heal_type='auto_unblock_for_competency_fill'` und `'targeted_competency_fill_lane_activation'`)
- **Cron `*/10 * * * *`** = `competency-fill-gap-routing-10min`

### Cockpit-SSOT-Anbindung
- `SmartNextBestAction` filtert jetzt `usePublishReadiness` mit `publish_ready === true && is_published !== true` (kanonisch)
- `admin-growth-seo-tower` `computePublishReadiness` queried direkt `v_admin_publish_readiness` statt nicht-existenter Status-Werte

## Invariante
- Jedes Paket mit `gap_severity='gap_blocking_publish'` UND `(building OR blocked content_gap)` MUSS innerhalb 10 Minuten + Cooldown einen aktiven `package_repair_exam_pool_competency_coverage`-Job haben.
- Karten „Bereit zur Veröffentlichung" dürfen NIE eigene Heuristiken nutzen, sondern ausschließlich `v_admin_publish_readiness.publish_ready` AND NOT `is_published`.

## Backfill-Resultat 2026-04-26
15 Pakete sofort enqueued (z. B. *Eisenbahner Zugverkehrssteuerung* 8.3% cov, *Maler/-in* 22.2%, *Automobilkaufmann/-frau* 41.8%). 12 davon wurden gleichzeitig aus `blocked` in `building` gehoben.
